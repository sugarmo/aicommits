import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture, createGit } from '../utils.js';

export default testSuite(({ describe }) => {
	describe('config', async ({ test, describe }) => {
		const { fixture, aicommits } = await createFixture();
		const configPath = path.join(fixture.path, '.aicommits', 'config.toml');
		const apiToken = 'api-key=test-token';

		test('set unknown config file', async () => {
			const { stderr } = await aicommits(['config', 'set', 'UNKNOWN=1'], {
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property: UNKNOWN');
		});

		test('set empty api-key', async () => {
			const { stderr } = await aicommits(['config', 'set', 'api-key='], {
				reject: false,
			});

			expect(stderr).toMatch('Please set your API key via `aicommits config set api-key=<your token>`');
		});

		await test('set config file', async () => {
			await aicommits(['config', 'set', apiToken]);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(/api-key\s*=\s*"test-token"/);
		});

		await test('get config file', async () => {
			const { stdout } = await aicommits(['config', 'get', 'api-key']);
			expect(stdout).toBe(apiToken);
		});

		await test('reading unknown config', async () => {
			await fs.appendFile(configPath, '\nUNKNOWN = 1\n');

			const { stdout, stderr } = await aicommits(['config', 'get', 'UNKNOWN'], {
				reject: false,
			});

			expect(stdout).toBe('');
			expect(stderr).toBe('');
		});

		await describe('timeout', ({ test }) => {
			test('setting invalid timeout config', async () => {
				const { stderr } = await aicommits(['config', 'set', 'timeout=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be an integer');
			});

			test('setting valid timeout config', async () => {
				const timeout = 'timeout=20000';
				await aicommits(['config', 'set', timeout]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(/timeout\s*=\s*20000/);

				const get = await aicommits(['config', 'get', 'timeout']);
				expect(get.stdout).toBe(timeout);
			});
		});

		await describe('base-url', ({ test }) => {
			test('setting invalid base-url config', async () => {
				const { stderr } = await aicommits(['config', 'set', 'base-url=example'], {
					reject: false,
				});

				expect(stderr).toMatch('Invalid config property base-url: Must be a valid URL');
			});

			test('setting valid base-url config', async () => {
				const baseUrl = 'base-url=https://api.example.com/v1';
				await aicommits(['config', 'set', baseUrl]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(/base-url\s*=\s*"https:\/\/api\.example\.com\/v1"/);

				const get = await aicommits(['config', 'get', 'base-url']);
				expect(get.stdout).toBe(baseUrl);
			});
		});

		await describe('profile', ({ test }) => {
			test('supports setting profile name', async () => {
				await aicommits(['config', 'set', 'profile=openai']);

				const get = await aicommits(['config', 'get', 'profile']);
				expect(get.stdout).toBe('profile=openai');
			});

			test('profile values override top-level values', async () => {
				await fs.writeFile(
					configPath,
					[
						'api-key = "top-level-key"',
						'model = "top-level-model"',
						'base-url = "https://api.top-level.example/v1"',
						'profile = "openai"',
						'',
						'[profiles.openai]',
						'model = "profile-model"',
						'base-url = "https://api.profile.example/v1"',
						'',
					].join('\n'),
					'utf8',
				);

				const modelGet = await aicommits(['config', 'get', 'model']);
				expect(modelGet.stdout).toBe('model=profile-model');

				const baseUrlGet = await aicommits(['config', 'get', 'base-url']);
				expect(baseUrlGet.stdout).toBe('base-url=https://api.profile.example/v1');
			});
		});

		await describe('locale', ({ test }) => {
			test('normalizes cn alias to zh-CN', async () => {
				await aicommits(['config', 'set', 'locale=cn']);

				const get = await aicommits(['config', 'get', 'locale']);
				expect(get.stdout).toBe('locale=zh-CN');
			});
		});

		await describe('details', ({ test }) => {
			test('must be a boolean', async () => {
				const { stderr } = await aicommits(['config', 'set', 'details=maybe'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be a boolean/i);
			});

			test('accepts numeric boolean values', async () => {
				await aicommits(['config', 'set', 'details=1']);

				const get = await aicommits(['config', 'get', 'details']);
				expect(get.stdout).toBe('details=true');
			});
		});

		await describe('show-reasoning', ({ test }) => {
			test('defaults to false', async () => {
				const get = await aicommits(['config', 'get', 'show-reasoning']);
				expect(get.stdout).toBe('show-reasoning=false');
			});

			test('must be a boolean', async () => {
				const { stderr } = await aicommits(['config', 'set', 'show-reasoning=maybe'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be a boolean/i);
			});

			test('can be enabled', async () => {
				await aicommits(['config', 'set', 'show-reasoning=true']);

				const get = await aicommits(['config', 'get', 'show-reasoning']);
				expect(get.stdout).toBe('show-reasoning=true');
			});
		});

		await describe('details-style', ({ test }) => {
			test('must be paragraph or list', async () => {
				const { stderr } = await aicommits(['config', 'set', 'details-style=table'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be one of: paragraph, list/i);
			});

			test('stores list style', async () => {
				await aicommits(['config', 'set', 'details-style=list']);

				const get = await aicommits(['config', 'get', 'details-style']);
				expect(get.stdout).toBe('details-style=list');
			});
		});

		await describe('conventional customization', ({ test }) => {
			test('validates conventional-types as JSON object', async () => {
				const { stderr } = await aicommits(['config', 'set', 'conventional-types=not-json'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be valid json/i);
			});

			test('stores conventional-format and conventional-types', async () => {
				const format = 'conventional-format=<type>(<scope>): <subject>';
				const customTypes = 'conventional-types={"feature":"Add a new capability","bugfix":"Fix defects"}';

				await aicommits(['config', 'set', format, customTypes]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(/conventional-format\s*=\s*"<type>\(<scope>\): <subject>"/);
				expect(configFile).toMatch(/conventional-types\s*=\s*".*feature.*bugfix.*"/);

				const formatGet = await aicommits(['config', 'get', 'conventional-format']);
				expect(formatGet.stdout).toBe(format);

				const typesGet = await aicommits(['config', 'get', 'conventional-types']);
				expect(typesGet.stdout).toBe('conventional-types={"feature":"Add a new capability","bugfix":"Fix defects"}');
			});
		});

		await describe('conventional-scope', ({ test }) => {
			test('defaults to false and can be toggled', async () => {
				const get = await aicommits(['config', 'get', 'conventional-scope']);
				expect(get.stdout).toBe('conventional-scope=false');
				await aicommits(['config', 'set', 'conventional-scope=true']);

				const enabled = await aicommits(['config', 'get', 'conventional-scope']);
				expect(enabled.stdout).toBe('conventional-scope=true');

				await aicommits(['config', 'set', 'conventional-scope=false']);

				const disabled = await aicommits(['config', 'get', 'conventional-scope']);
				expect(disabled.stdout).toBe('conventional-scope=false');
			});
		});

		await describe('style preset removal', ({ test }) => {
			test('style is no longer a configurable option', async () => {
				const { stderr } = await aicommits(['config', 'set', 'style=github-copilot'], {
					reject: false,
				});

				expect(stderr).toMatch(/invalid config property: style/i);
			});
		});

		await describe('instructions', ({ test }) => {
			test('supports values containing "="', async () => {
				const instructions = 'instructions=Use detail=high and tone=neutral';
				await aicommits(['config', 'set', instructions]);

				const get = await aicommits(['config', 'get', 'instructions']);
				expect(get.stdout).toBe(instructions);
			});
		});

		await describe('max-length', ({ test }) => {
			test('must be an integer', async () => {
				const { stderr } = await aicommits(['config', 'set', 'max-length=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be an integer');
			});

			test('must be at least 20 characters', async () => {
				const { stderr } = await aicommits(['config', 'set', 'max-length=10'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be greater than 20 characters/i);
			});

			test('updates config', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'max-length']);
				expect(defaultConfig.stdout).toBe('max-length=50');

				const maxLength = 'max-length=60';
				await aicommits(['config', 'set', maxLength]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(/max-length\s*=\s*60/);

				const get = await aicommits(['config', 'get', 'max-length']);
				expect(get.stdout).toBe(maxLength);
			});
		});

		await test('set config file', async () => {
			await aicommits(['config', 'set', apiToken]);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(/api-key\s*=\s*"test-token"/);
		});

		await test('get config file', async () => {
			const { stdout } = await aicommits(['config', 'get', 'api-key']);
			expect(stdout).toBe(apiToken);
		});

		await test('missing base-url fails when running aicommits', async () => {
			const { fixture: runtimeFixture, aicommits: runtimeAicommits } = await createFixture({
				'.aicommits/config.toml': 'api-key = "test-token"',
				'data.json': '1. lorem ipsum',
			});
			const git = await createGit(runtimeFixture.path);

			await git('add', ['data.json']);

			const { stderr, stdout, exitCode } = await runtimeAicommits([], {
				reject: false,
			});

			expect(exitCode).toBe(1);
			expect(`${stdout}\n${stderr}`).toMatch('Please set your API base URL via `aicommits config set base-url=<https://...>`');

			await runtimeFixture.rm();
		});

		await fixture.rm();
	});
});
