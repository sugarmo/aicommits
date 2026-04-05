import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import { testSuite, expect } from 'manten';
import {
	createFixture,
	createGit,
	files,
	hasLiveTestProviderConfig,
	warnSkippedLiveTests,
} from '../../utils.js';

const conventionalCommitPattern = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]+\))?:\s+\S/;

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

export default testSuite(({ describe }) => {
	if (process.platform === 'win32') {
		console.warn('Skipping tests on Windows because Node.js spawn cant open TTYs');
		return;
	}

	describe('Commits', async ({ test }) => {
		test('Excludes files', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);
			const { stdout, exitCode } = await aicommits(['--exclude', 'data.json'], { reject: false });
			expect(exitCode).toBe(1);
			expect(stdout).toMatch('No staged changes found.');

			await fixture.rm();
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
