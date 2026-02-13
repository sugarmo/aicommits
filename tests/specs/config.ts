import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture } from '../utils.js';

export default testSuite(({ describe }) => {
	describe('config', async ({ test, describe }) => {
		const { fixture, aicommits } = await createFixture();
		const configPath = path.join(fixture.path, '.aicommits');
		const openAiToken = 'OPENAI_KEY=sk-abc';

		test('set unknown config file', async () => {
			const { stderr } = await aicommits(['config', 'set', 'UNKNOWN=1'], {
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property: UNKNOWN');
		});

		test('set invalid OPENAI_KEY', async () => {
			const { stderr } = await aicommits(['config', 'set', 'OPENAI_KEY=abc'], {
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property OPENAI_KEY: Must start with "sk-"');
		});

		await test('set config file', async () => {
			await aicommits(['config', 'set', openAiToken]);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(openAiToken);
		});

		await test('get config file', async () => {
			const { stdout } = await aicommits(['config', 'get', 'OPENAI_KEY']);
			expect(stdout).toBe(openAiToken);
		});

		await test('reading unknown config', async () => {
			await fs.appendFile(configPath, 'UNKNOWN=1');

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
				expect(configFile).toMatch(timeout);

				const get = await aicommits(['config', 'get', 'timeout']);
				expect(get.stdout).toBe(timeout);
			});
		});

		await describe('locale', ({ test }) => {
			test('normalizes cn alias to zh-CN', async () => {
				await aicommits(['config', 'set', 'locale=cn']);

				const get = await aicommits(['config', 'get', 'locale']);
				expect(get.stdout).toBe('locale=zh-CN');
			});
		});

		await describe('temperature', ({ test }) => {
			test('must be a number', async () => {
				const { stderr } = await aicommits(['config', 'set', 'temperature=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be a number');
			});

			test('must be in range 0..2', async () => {
				const { stderr } = await aicommits(['config', 'set', 'temperature=2.1'], {
					reject: false,
				});

				expect(stderr).toMatch(/less or equal to 2/i);
			});

			test('updates config', async () => {
				const temperature = 'temperature=1';
				await aicommits(['config', 'set', temperature]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(temperature);

				const get = await aicommits(['config', 'get', 'temperature']);
				expect(get.stdout).toBe(temperature);
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
				expect(configFile).toMatch('conventional-format=<type>(<scope>): <subject>');
				expect(configFile).toMatch('conventional-types={"feature":"Add a new capability","bugfix":"Fix defects"}');

				const formatGet = await aicommits(['config', 'get', 'conventional-format']);
				expect(formatGet.stdout).toBe(format);

				const typesGet = await aicommits(['config', 'get', 'conventional-types']);
				expect(typesGet.stdout).toBe('conventional-types={"feature":"Add a new capability","bugfix":"Fix defects"}');
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
				expect(configFile).toMatch(maxLength);

				const get = await aicommits(['config', 'get', 'max-length']);
				expect(get.stdout).toBe(maxLength);
			});
		});

		await test('set config file', async () => {
			await aicommits(['config', 'set', openAiToken]);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(openAiToken);
		});

		await test('get config file', async () => {
			const { stdout } = await aicommits(['config', 'get', 'OPENAI_KEY']);
			expect(stdout).toBe(openAiToken);
		});

		await fixture.rm();
	});
});
