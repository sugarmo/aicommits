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
				const { fixture: isolatedFixture, aicommits: isolatedAicommits } = await createFixture();
				await isolatedAicommits(['config', 'set', 'profile=openai']);

				const get = await isolatedAicommits(['config', 'get', 'profile']);
				expect(get.stdout).toBe('profile=openai');
				await isolatedFixture.rm();
			});

			test('profile values override top-level values', async () => {
				const { fixture: isolatedFixture, aicommits: isolatedAicommits } = await createFixture();
				const isolatedConfigPath = path.join(isolatedFixture.path, '.aicommits', 'config.toml');
				await fs.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
				await fs.writeFile(
					isolatedConfigPath,
					[
						'api-key = "top-level-key"',
						'model = "top-level-model"',
						'base-url = "https://api.top-level.example/v1"',
						'api-mode = "responses"',
						'profile = "openai"',
						'',
						'[profiles.openai]',
						'model = "profile-model"',
						'base-url = "https://api.profile.example/v1"',
						'reasoning-effort = "high"',
						'api-mode = "chat"',
						'',
					].join('\n'),
					'utf8',
				);

				const modelGet = await isolatedAicommits(['config', 'get', 'model']);
				expect(modelGet.stdout).toBe('model=profile-model');

				const baseUrlGet = await isolatedAicommits(['config', 'get', 'base-url']);
				expect(baseUrlGet.stdout).toBe('base-url=https://api.profile.example/v1');

				const reasoningEffortGet = await isolatedAicommits(['config', 'get', 'reasoning-effort']);
				expect(reasoningEffortGet.stdout).toBe('reasoning-effort=high');

				const apiModeGet = await isolatedAicommits(['config', 'get', 'api-mode']);
				expect(apiModeGet.stdout).toBe('api-mode=chat');
				await isolatedFixture.rm();
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
				const { fixture: isolatedFixture, aicommits: isolatedAicommits } = await createFixture();
				const get = await isolatedAicommits(['config', 'get', 'show-reasoning']);
				expect(get.stdout).toBe('show-reasoning=false');
				await isolatedFixture.rm();
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

		await describe('reasoning-effort', ({ test }) => {
			test('defaults to empty', async () => {
				const { fixture: isolatedFixture, aicommits: isolatedAicommits } = await createFixture();
				const get = await isolatedAicommits(['config', 'get', 'reasoning-effort']);
				expect(get.stdout).toBe('reasoning-effort=');
				await isolatedFixture.rm();
			});

			test('must be none, low, medium, high, or xhigh', async () => {
				const { stderr } = await aicommits(['config', 'set', 'reasoning-effort=turbo'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be one of: none, low, medium, high, xhigh/i);
			});

			test('can be set to high', async () => {
				await aicommits(['config', 'set', 'reasoning-effort=high']);

				const get = await aicommits(['config', 'get', 'reasoning-effort']);
				expect(get.stdout).toBe('reasoning-effort=high');
			});
		});

		await describe('api-mode', ({ test }) => {
			test('defaults to responses', async () => {
				const { fixture: isolatedFixture, aicommits: isolatedAicommits } = await createFixture();
				const get = await isolatedAicommits(['config', 'get', 'api-mode']);
				expect(get.stdout).toBe('api-mode=responses');
				await isolatedFixture.rm();
			});

			test('must be responses or chat', async () => {
				const { stderr } = await aicommits(['config', 'set', 'api-mode=legacy'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be one of: responses, chat/i);
			});

			test('can be set to chat', async () => {
				await aicommits(['config', 'set', 'api-mode=chat']);

				const get = await aicommits(['config', 'get', 'api-mode']);
				expect(get.stdout).toBe('api-mode=chat');
			});
		});

		await describe('details-style', ({ test }) => {
			test('must be paragraph, list, or markdown', async () => {
				const { stderr } = await aicommits(['config', 'set', 'details-style=table'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be one of: paragraph, list, markdown/i);
			});

			test('stores list style', async () => {
				const { fixture: isolatedFixture, aicommits: isolatedAicommits } = await createFixture();
				await isolatedAicommits(['config', 'set', 'details-style=list']);

				const get = await isolatedAicommits(['config', 'get', 'details-style']);
				expect(get.stdout).toBe('details-style=list');
				await isolatedFixture.rm();
			});

			test('stores markdown style', async () => {
				const { fixture: isolatedFixture, aicommits: isolatedAicommits } = await createFixture();
				await isolatedAicommits(['config', 'set', 'details-style=markdown']);

				const get = await isolatedAicommits(['config', 'get', 'details-style']);
				expect(get.stdout).toBe('details-style=markdown');
				await isolatedFixture.rm();
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

		await describe('request-options', ({ test }) => {
			test('validates request-options as JSON object', async () => {
				const { stderr } = await aicommits(['config', 'set', 'request-options=not-json'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be valid json/i);
			});

			test('rejects non-object request-options', async () => {
				const { stderr } = await aicommits(['config', 'set', 'request-options=[1,2,3]'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be a json object/i);
			});

			test('stores request-options payload', async () => {
				const requestOptions = 'request-options={"thinking":{"type":"disabled"}}';
				await aicommits(['config', 'set', requestOptions]);

				const get = await aicommits(['config', 'get', 'request-options']);
				expect(get.stdout).toBe(requestOptions);
			});
		});

		await describe('context-window', ({ test }) => {
			test('must be an integer', async () => {
				const { stderr } = await aicommits(['config', 'set', 'context-window=abc'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be an integer/i);
			});

			test('must be greater than or equal to 1024 tokens', async () => {
				const { stderr } = await aicommits(['config', 'set', 'context-window=512'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be 0 \(auto\) or greater than or equal to 1024 tokens/i);
			});

			test('stores numeric and suffix context-window values and supports zero reset', async () => {
				const contextWindow = 'context-window=32768';
				await aicommits(['config', 'set', contextWindow]);

				const stored = await aicommits(['config', 'get', 'context-window']);
				expect(stored.stdout).toBe(contextWindow);

				await aicommits(['config', 'set', 'context-window=32K']);
				const fromK = await aicommits(['config', 'get', 'context-window']);
				expect(fromK.stdout).toBe('context-window=32768');

				await aicommits(['config', 'set', 'context-window=1M']);
				const fromM = await aicommits(['config', 'get', 'context-window']);
				expect(fromM.stdout).toBe('context-window=1048576');

				await aicommits(['config', 'set', 'context-window=0']);

				const reset = await aicommits(['config', 'get', 'context-window']);
				expect(reset.stdout).toBe('context-window=0');
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

		await describe('title-length-guide', ({ test }) => {
			test('must be an integer', async () => {
				const { stderr } = await aicommits(['config', 'set', 'title-length-guide=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be an integer');
			});

			test('must be at least 20 characters', async () => {
				const { stderr } = await aicommits(['config', 'set', 'title-length-guide=10'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be greater than 20 characters/i);
			});

			test('updates config', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'title-length-guide']);
				expect(defaultConfig.stdout).toBe('title-length-guide=50');

				const titleLengthGuide = 'title-length-guide=60';
				await aicommits(['config', 'set', titleLengthGuide]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(/title-length-guide\s*=\s*60/);
				expect(configFile).not.toMatch(/max-length\s*=/);

				const get = await aicommits(['config', 'get', 'title-length-guide']);
				expect(get.stdout).toBe(titleLengthGuide);
			});

			test('accepts legacy max-length alias and normalizes to new key', async () => {
				const { fixture: isolatedFixture, aicommits: isolatedAicommits } = await createFixture();
				const isolatedConfigPath = path.join(isolatedFixture.path, '.aicommits', 'config.toml');
				await isolatedAicommits(['config', 'set', 'max-length=65']);

				const configFile = await fs.readFile(isolatedConfigPath, 'utf8');
				expect(configFile).toMatch(/title-length-guide\s*=\s*65/);
				expect(configFile).not.toMatch(/max-length\s*=/);

				const getLegacy = await isolatedAicommits(['config', 'get', 'max-length']);
				expect(getLegacy.stdout).toBe('title-length-guide=65');
				await isolatedFixture.rm();
			});
		});

		await describe('detail-column-guide', ({ test }) => {
			test('must be an integer', async () => {
				const { stderr } = await aicommits(['config', 'set', 'detail-column-guide=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be an integer');
			});

			test('must be at least 20 characters', async () => {
				const { stderr } = await aicommits(['config', 'set', 'detail-column-guide=10'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be greater than 20 characters/i);
			});

			test('updates config', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'detail-column-guide']);
				expect(defaultConfig.stdout).toBe('detail-column-guide=72');

				const detailColumnGuide = 'detail-column-guide=88';
				await aicommits(['config', 'set', detailColumnGuide]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(/detail-column-guide\s*=\s*88/);

				const get = await aicommits(['config', 'get', 'detail-column-guide']);
				expect(get.stdout).toBe(detailColumnGuide);
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
