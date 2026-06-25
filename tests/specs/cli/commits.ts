import fs from 'fs/promises';
import https from 'https';
import net from 'net';
import type { AddressInfo } from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { testSuite, expect } from 'manten';
import {
	createFixture,
	createGit,
	files,
	hasLiveTestProviderConfig,
	warnSkippedLiveTests,
} from '../../utils.js';

const conventionalCommitPattern = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]+\))?:\s+\S/;
const printOnlyMessage = 'fix(cli): print generated commit message';
const testHttpsKeyPath = fileURLToPath(new URL('../../fixtures/local-https.key.pem', import.meta.url));
const testHttpsCertificatePath = fileURLToPath(new URL('../../fixtures/local-https.cert.pem', import.meta.url));

const conventionalMessageFile = [
	'# Commit Message Instructions',
	'',
	'## Language',
	'- Write the commit message in English.',
	'',
	'## Format',
	'- Use conventional commit formatting.',
	'- Prefer `type(scope): subject` when there is a clear dominant anchor.',
	'- Return only the title line with no body.',
	'',
	'## Style',
	'- Use concise imperative wording.',
	'- Focus on the dominant outcome first.',
].join('\n');

const waitForCommitPromptAndAccept = (committing: ReturnType<Awaited<ReturnType<typeof createFixture>>['aicommits']>) => {
	committing.stdout!.on('data', (buffer: Buffer) => {
		const stdout = buffer.toString();
		if (stdout.match('└')) {
			committing.stdin!.write('y');
			committing.stdin!.end();
		}
	});
};

const isLocalProxyReachable = (port = 8888) => new Promise<boolean>((resolve) => {
	const socket = net.createConnection({
		host: '127.0.0.1',
		port,
	});

	const closeAndResolve = (value: boolean) => {
		socket.removeAllListeners();
		socket.destroy();
		resolve(value);
	};

	socket.setTimeout(300);
	socket.once('connect', () => closeAndResolve(true));
	socket.once('timeout', () => closeAndResolve(false));
	socket.once('error', () => closeAndResolve(false));
});

const createFakeResponsesApi = async (message: string) => {
	const [key, cert] = await Promise.all([
		fs.readFile(testHttpsKeyPath, 'utf8'),
		fs.readFile(testHttpsCertificatePath, 'utf8'),
	]);
	let requestCount = 0;
	const requestBodies: unknown[] = [];

	// Production config requires HTTPS provider URLs, so the fake provider uses fixture TLS.
	const server = https.createServer({
		key,
		cert,
	}, (request, response) => {
		requestCount += 1;

		if (request.method !== 'POST' || request.url !== '/v1/responses') {
			request.resume();
			response.writeHead(404);
			response.end();
			return;
		}

		const chunks: Buffer[] = [];
		request.on('data', chunk => chunks.push(chunk));
		request.on('end', () => {
			const body = Buffer.concat(chunks).toString();
			if (body.trim()) {
				requestBodies.push(JSON.parse(body));
			}

			response.writeHead(200, {
				'Content-Type': 'application/json',
			});
			response.end(JSON.stringify({
				model: 'test-model',
				output: [
					{
						type: 'message',
						role: 'assistant',
						content: [
							{
								type: 'output_text',
								text: message,
							},
						],
					},
				],
			}));
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address() as AddressInfo;

	return {
		baseUrl: `https://127.0.0.1:${address.port}/v1`,
		getRequestCount: () => requestCount,
		getRequestBodies: () => requestBodies,
		close: () => new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}

				resolve();
			});
		}),
	};
};

export default testSuite(({ describe }) => {
	if (process.platform === 'win32') {
		console.warn('Skipping tests on Windows because Node.js spawn cant open TTYs');
		return;
	}

	describe('Commits', async ({ test }) => {
		test('rejects deprecated -t alias with migration guidance', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const { stdout, stderr, exitCode } = await aicommits(['-t', 'conventional'], {
				reject: false,
			});

			expect(exitCode).toBe(1);
			expect(`${stdout}\n${stderr}`).toMatch('Flag "--type" has been removed');
			expect(`${stdout}\n${stderr}`).toMatch('message.md');

			await fixture.rm();
		});

		test('Excludes files', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);
			const { stdout, exitCode } = await aicommits(['--exclude', 'data.json'], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('No staged changes found.');

			await fixture.rm();
		});

		const expectPrintOnlyFlag = async (
			flag: '--print' | '--no-commit',
			onTestFail: (callback: () => void) => void,
		) => {
			const fakeApi = await createFakeResponsesApi(printOnlyMessage);
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits/config.toml': [
					'api-key = "test-key"',
					`base-url = ${JSON.stringify(fakeApi.baseUrl)}`,
					'model = "gpt-4o-mini"',
				].join('\n'),
			});
			const git = await createGit(fixture.path);

			try {
				await git('add', ['data.json']);

				const { stdout, stderr, exitCode } = await aicommits([flag], {
					reject: false,
					timeout: 7000,
					env: {
						NODE_EXTRA_CA_CERTS: testHttpsCertificatePath,
					},
				});
				const head = await git('rev-parse', ['--verify', 'HEAD'], {
					reject: false,
				});

				onTestFail(() => console.log({
					stdout,
					stderr,
					exitCode,
					headExitCode: head.exitCode,
				}));
				expect(exitCode).toBe(0);
				expect(stdout).toMatch(printOnlyMessage);
				expect(stdout).not.toMatch('Successfully committed');
				expect(head.exitCode).not.toBe(0);
				expect(fakeApi.getRequestCount()).toBe(1);
			} finally {
				await fakeApi.close();
				await fixture.rm();
			}
		};

		test('prints generated commit message without committing', async ({ onTestFail }) => {
			await expectPrintOnlyFlag('--print', onTestFail);
		});

		test('supports --no-commit as a print-only alias', async ({ onTestFail }) => {
			await expectPrintOnlyFlag('--no-commit', onTestFail);
		});

		test('passes --steer text into the generation instructions', async ({ onTestFail }) => {
			const fakeApi = await createFakeResponsesApi(printOnlyMessage);
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits/config.toml': [
					'api-key = "test-key"',
					`base-url = ${JSON.stringify(fakeApi.baseUrl)}`,
					'model = "gpt-4o-mini"',
				].join('\n'),
			});
			const git = await createGit(fixture.path);

			try {
				await git('add', ['data.json']);

				const { stdout, stderr, exitCode } = await aicommits([
					'--steer',
					'Fix the page failing to load',
					'--print',
				], {
					reject: false,
					timeout: 7000,
					env: {
						NODE_EXTRA_CA_CERTS: testHttpsCertificatePath,
					},
				});

				const [requestBody] = fakeApi.getRequestBodies();
				const instructions = (
					typeof requestBody === 'object'
					&& requestBody !== null
					&& 'instructions' in requestBody
					&& typeof requestBody.instructions === 'string'
				)
					? requestBody.instructions
					: '';

				onTestFail(() => console.log({
					stdout,
					stderr,
					exitCode,
					requestBody,
				}));
				expect(exitCode).toBe(0);
				expect(instructions).toMatch('User-provided commit intent:');
				expect(instructions).toMatch('Fix the page failing to load');
			} finally {
				await fakeApi.close();
				await fixture.rm();
			}
		});

		test('treats empty --steer text as omitted', async ({ onTestFail }) => {
			const fakeApi = await createFakeResponsesApi(printOnlyMessage);
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits/config.toml': [
					'api-key = "test-key"',
					`base-url = ${JSON.stringify(fakeApi.baseUrl)}`,
					'model = "gpt-4o-mini"',
				].join('\n'),
			});
			const git = await createGit(fixture.path);

			try {
				await git('add', ['data.json']);

				const { stdout, stderr, exitCode } = await aicommits([
					'--steer',
					'',
					'--print',
				], {
					reject: false,
					timeout: 7000,
					env: {
						NODE_EXTRA_CA_CERTS: testHttpsCertificatePath,
					},
				});

				const [requestBody] = fakeApi.getRequestBodies();
				const instructions = (
					typeof requestBody === 'object'
					&& requestBody !== null
					&& 'instructions' in requestBody
					&& typeof requestBody.instructions === 'string'
				)
					? requestBody.instructions
					: '';

				onTestFail(() => console.log({
					stdout,
					stderr,
					exitCode,
					requestBody,
				}));
				expect(exitCode).toBe(0);
				expect(instructions).not.toMatch('User-provided commit intent:');
			} finally {
				await fakeApi.close();
				await fixture.rm();
			}
		});

		test('commits with --steer and --yes without passing them to git commit', async ({ onTestFail }) => {
			const fakeApi = await createFakeResponsesApi(printOnlyMessage);
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits/config.toml': [
					'api-key = "test-key"',
					`base-url = ${JSON.stringify(fakeApi.baseUrl)}`,
					'model = "gpt-4o-mini"',
				].join('\n'),
			});
			const git = await createGit(fixture.path);

			try {
				await git('add', ['data.json']);

				const { stdout, stderr, exitCode } = await aicommits([
					'--steer',
					'Fix the page failing to load',
					'--yes',
				], {
					reject: false,
					timeout: 7000,
					env: {
						NODE_EXTRA_CA_CERTS: testHttpsCertificatePath,
					},
				});
				const { stdout: commitMessage } = await git('log', ['--pretty=format:%s'], {
					reject: false,
				});

				onTestFail(() => console.log({
					stdout,
					stderr,
					exitCode,
					commitMessage,
				}));
				expect(exitCode).toBe(0);
				expect(commitMessage).toBe(printOnlyMessage);
			} finally {
				await fakeApi.close();
				await fixture.rm();
			}
		});

		test('commits with --yes before --steer', async ({ onTestFail }) => {
			const fakeApi = await createFakeResponsesApi(printOnlyMessage);
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits/config.toml': [
					'api-key = "test-key"',
					`base-url = ${JSON.stringify(fakeApi.baseUrl)}`,
					'model = "gpt-4o-mini"',
				].join('\n'),
			});
			const git = await createGit(fixture.path);

			try {
				await git('add', ['data.json']);

				const { stdout, stderr, exitCode } = await aicommits([
					'--yes',
					'--steer',
					'Fix the page failing to load',
				], {
					reject: false,
					timeout: 7000,
					env: {
						NODE_EXTRA_CA_CERTS: testHttpsCertificatePath,
					},
				});
				const { stdout: commitMessage } = await git('log', ['--pretty=format:%s'], {
					reject: false,
				});

				onTestFail(() => console.log({
					stdout,
					stderr,
					exitCode,
					commitMessage,
				}));
				expect(exitCode).toBe(0);
				expect(commitMessage).toBe(printOnlyMessage);
			} finally {
				await fakeApi.close();
				await fixture.rm();
			}
		});

		if (!hasLiveTestProviderConfig()) {
			warnSkippedLiveTests('CLI commit generation');
			return;
		}

		test('Generates commit message and creates default message.md', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const committing = aicommits();
			waitForCommitPromptAndAccept(committing);
			await committing;

			const { stdout: commitMessage } = await git('log', ['--pretty=format:%B']);
			expect(commitMessage.trim().length).toBeGreaterThan(0);

			const messageFile = await fs.readFile(path.join(fixture.path, '.aicommits', 'message.md'), 'utf8');
			expect(messageFile).toMatch('# Commit Message Instructions');

			await fixture.rm();
		});

		test('Accepts --all flag, staging tracked changes before commit', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);
			await git('commit', ['-m', 'wip']);
			await fixture.writeFile('data.json', 'Test');

			const committing = aicommits(['--all']);
			waitForCommitPromptAndAccept(committing);
			await committing;

			const statusAfter = await git('status', ['--short']);
			expect(statusAfter.stdout).toBe('?? .aicommits/');

			await fixture.rm();
		});

		test('Accepts --generate flag, overriding config', async ({ onTestFail }) => {
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits/config.toml': `${files['.aicommits/config.toml']}\ngenerate = 4`,
			});
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const committing = aicommits(['--generate', '2']);
			committing.stdout!.on('data', function onPrompt(buffer: Buffer) {
				const stdout = buffer.toString();
				if (stdout.match('└')) {
					committing.stdin!.write('\r');
					committing.stdin!.end();
					committing.stdout?.off('data', onPrompt);
				}
			});

			const { stdout } = await committing;
			const countChoices = stdout.match(/ {2}[●○]/g)?.length ?? 0;

			onTestFail(() => console.log({ stdout }));
			expect(countChoices).toBeGreaterThan(0);
			expect(countChoices).toBeLessThanOrEqual(2);

			await fixture.rm();
		});

		test('reads a custom markdown file via --message-file', async () => {
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits/custom.md': conventionalMessageFile,
			});
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const committing = aicommits(['--message-file', 'custom.md']);
			waitForCommitPromptAndAccept(committing);
			await committing;

			const { stdout: commitMessage } = await git('log', ['--pretty=format:%s']);
			expect(commitMessage).toMatch(conventionalCommitPattern);

			await fixture.rm();
		});

		test('applies post-response-script before commit', async () => {
			const { fixture, aicommits } = await createFixture({
				...files,
				'.aicommits/rewrite.sh': [
					'#!/bin/sh',
					'input=$(cat)',
					'printf "POST: %s\\n" "$input"',
				].join('\n'),
			});
			const git = await createGit(fixture.path);

			await fs.chmod(path.join(fixture.path, '.aicommits', 'rewrite.sh'), 0o755);
			await git('add', ['data.json']);

			const committing = aicommits(['--post-response-script', 'rewrite.sh']);
			waitForCommitPromptAndAccept(committing);
			await committing;

			const { stdout: commitMessage } = await git('log', ['--pretty=format:%s']);
			expect(commitMessage.startsWith('POST: ')).toBe(true);

			await fixture.rm();
		});

		describe('proxy', ({ test }) => {
			test('Fails on invalid proxy', async () => {
				const { fixture, aicommits } = await createFixture({
					...files,
					'.aicommits/config.toml': `${files['.aicommits/config.toml']}\nproxy = "http://localhost:1234"`,
				});
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				const committing = aicommits([], {
					reject: false,
				});
				waitForCommitPromptAndAccept(committing);

				const { stdout, stderr, exitCode } = await committing;
				expect(exitCode).toBe(1);
				expect(`${stdout}\n${stderr}`).toMatch(/ECONNREFUSED|internalConnectMultiple/);

				await fixture.rm();
			});

			test('Connects with config', async () => {
				if (!(await isLocalProxyReachable())) {
					console.warn('Skipping proxy connectivity test because localhost:8888 is unavailable');
					return;
				}

				const { fixture, aicommits } = await createFixture({
					...files,
					'.aicommits/config.toml': `${files['.aicommits/config.toml']}\nproxy = "http://localhost:8888"`,
				});
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				const committing = aicommits();
				waitForCommitPromptAndAccept(committing);
				await committing;

				await fixture.rm();
			});

			test('Connects with env variable', async () => {
				if (!(await isLocalProxyReachable())) {
					console.warn('Skipping proxy connectivity test because localhost:8888 is unavailable');
					return;
				}

				const { fixture, aicommits } = await createFixture(files);
				const git = await createGit(fixture.path);

				await git('add', ['data.json']);

				const committing = aicommits([], {
					env: {
						HTTP_PROXY: 'http://localhost:8888',
					},
				});
				waitForCommitPromptAndAccept(committing);
				await committing;

				await fixture.rm();
			});
		});
	});
});
