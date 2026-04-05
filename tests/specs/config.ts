import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture, createGit } from '../utils.js';

export default testSuite(({ describe }) => {
	describe('config', async ({ test }) => {
		test('rejects unknown config keys', async () => {
			const { fixture, aicommits } = await createFixture();
			const { stderr } = await aicommits(['config', 'set', 'UNKNOWN=1'], {
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property: UNKNOWN');
			await fixture.rm();
		});

		test('stores and reads active config values', async () => {
			const { fixture, aicommits } = await createFixture();
			const configPath = path.join(fixture.path, '.aicommits', 'config.toml');

			await aicommits([
				'config',
				'set',
				'api-key=test-token',
				'base-url=https://api.example.com/v1',
				'message-path=templates/release.md',
				'post-response-script=scripts/post-process.sh',
			]);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(/api-key\s*=\s*"test-token"/);
			expect(configFile).toMatch(/message-path\s*=\s*"templates\/release\.md"/);
			expect(configFile).toMatch(/post-response-script\s*=\s*"scripts\/post-process\.sh"/);

			const messagePathGet = await aicommits(['config', 'get', 'message-path']);
			expect(messagePathGet.stdout).toBe('message-path=templates/release.md');

			const scriptGet = await aicommits(['config', 'get', 'post-response-script']);
			expect(scriptGet.stdout).toBe('post-response-script=scripts/post-process.sh');

			await fixture.rm();
		});

		test('returns default message-path when unset', async () => {
			const { fixture, aicommits } = await createFixture();

			const get = await aicommits(['config', 'get', 'message-path']);
			expect(get.stdout).toBe('message-path=message.md');

			await fixture.rm();
		});

		test('rejects deprecated message config keys', async () => {
			const { fixture, aicommits } = await createFixture();
			const { stderr } = await aicommits(['config', 'set', 'details=true'], {
				reject: false,
			});

			expect(stderr).toMatch('has moved to your message Markdown file');
			expect(stderr).toMatch('message.md');
			await fixture.rm();
		});

		test('migrates top-level legacy message config into message.md', async () => {
			const { fixture, aicommits } = await createFixture({
				'.aicommits/config.toml': [
					'api-key = "test-token"',
					'base-url = "https://api.example.com/v1"',
					'type = "conventional"',
					'locale = "ja"',
					'details = true',
					'conventional-scope = true',
					'title-length-guide = 64',
					'instructions = "Use release-note wording."',
				].join('\n'),
			});

			const messagePath = path.join(fixture.path, '.aicommits', 'message.md');
			const configPath = path.join(fixture.path, '.aicommits', 'config.toml');
			const backupPath = path.join(fixture.path, '.aicommits', 'config.toml.bak');
			const originalConfig = await fs.readFile(configPath, 'utf8');

			const get = await aicommits(['config', 'get', 'api-key']);
			expect(get.stdout).toBe('api-key=test-token');

			const messageFile = await fs.readFile(messagePath, 'utf8');
			expect(messageFile).toMatch('Write the commit message strictly in ja.');
			expect(messageFile).toMatch('Use conventional commit formatting.');
			expect(messageFile).toMatch('Use release-note wording.');

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).not.toMatch(/\blocale\b/);
			expect(configFile).not.toMatch(/\btype\b/);
			expect(configFile).not.toMatch(/\bdetails\b/);

			const backupFile = await fs.readFile(backupPath, 'utf8');
			expect(backupFile).toBe(originalConfig);

			await fixture.rm();
		});

		test('does not overwrite an existing message.md during migration', async () => {
			const existingMessage = '# Custom Instructions\n- Keep my custom wording.';
			const { fixture, aicommits } = await createFixture({
				'.aicommits/config.toml': [
					'api-key = "test-token"',
					'base-url = "https://api.example.com/v1"',
					'locale = "zh-CN"',
				].join('\n'),
				'.aicommits/message.md': existingMessage,
			});

			await aicommits(['config', 'get', 'api-key']);

			const messageFile = await fs.readFile(path.join(fixture.path, '.aicommits', 'message.md'), 'utf8');
			expect(messageFile.trim()).toBe(existingMessage);

			await fixture.rm();
		});

		test('migrates profile-specific legacy message config to its own markdown file', async () => {
			const { fixture, aicommits } = await createFixture({
				'.aicommits/config.toml': [
					'api-key = "top-level-key"',
					'base-url = "https://api.top-level.example/v1"',
					'profile = "openai"',
					'',
					'[profiles.openai]',
					'api-key = "profile-key"',
					'base-url = "https://api.profile.example/v1"',
					'type = "conventional"',
					'details = true',
				].join('\n'),
			});

			const configPath = path.join(fixture.path, '.aicommits', 'config.toml');
			await aicommits(['config', 'get', 'api-key']);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(/message-path\s*=\s*"message\.openai\.md"/);
			expect(configFile).not.toMatch(/\[profiles\.openai\][\s\S]*type\s*=/);

			const profileMessage = await fs.readFile(
				path.join(fixture.path, '.aicommits', 'message.openai.md'),
				'utf8',
			);
			expect(profileMessage).toMatch('Use conventional commit formatting.');
			expect(profileMessage).toMatch('Include a body only when the title alone is not sufficient.');

			await fixture.rm();
		});

		test('does not rewrite config.toml when migrated message markdown cannot be created', async () => {
			const originalConfig = [
				'api-key = "test-token"',
				'base-url = "https://api.example.com/v1"',
				'details = true',
				'message-path = "templates"',
			].join('\n');
			const { fixture, aicommits } = await createFixture({
				'.aicommits/config.toml': originalConfig,
			});

			await fs.mkdir(path.join(fixture.path, '.aicommits', 'templates'), { recursive: true });

			const { exitCode, stderr } = await aicommits(['config', 'get', 'api-key'], {
				reject: false,
			});

			expect(exitCode).toBe(1);
			expect(stderr).toMatch('must point to a file');

			const configPath = path.join(fixture.path, '.aicommits', 'config.toml');
			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toBe(originalConfig);

			let backupExists = true;
			try {
				await fs.readFile(path.join(fixture.path, '.aicommits', 'config.toml.bak'), 'utf8');
			} catch {
				backupExists = false;
			}

			expect(backupExists).toBe(false);

			await fixture.rm();
		});

		test('does not overwrite an existing config.toml.bak during migration', async () => {
			const existingBackup = [
				'api-key = "original-token"',
				'details = true',
			].join('\n');
			const { fixture, aicommits } = await createFixture({
				'.aicommits/config.toml': [
					'api-key = "test-token"',
					'base-url = "https://api.example.com/v1"',
					'details = true',
				].join('\n'),
				'.aicommits/config.toml.bak': existingBackup,
			});

			await aicommits(['config', 'get', 'api-key']);

			const backupFile = await fs.readFile(
				path.join(fixture.path, '.aicommits', 'config.toml.bak'),
				'utf8',
			);
			expect(backupFile.trim()).toBe(existingBackup);

			await fixture.rm();
		});

		test('migrates legacy single-file ~/.aicommits configs into the new directory layout', async () => {
			const { fixture, aicommits } = await createFixture({
				'.aicommits': [
					'api-key = "test-token"',
					'base-url = "https://api.example.com/v1"',
					'details = true',
					'details-style = "markdown"',
				].join('\n'),
			});

			const get = await aicommits(['config', 'get', 'api-key']);
			expect(get.stdout).toBe('api-key=test-token');

			const migratedConfigDirectory = path.join(fixture.path, '.aicommits');
			const migratedConfigStats = await fs.lstat(migratedConfigDirectory);
			expect(migratedConfigStats.isDirectory()).toBe(true);

			const migratedConfigFile = await fs.readFile(path.join(migratedConfigDirectory, 'config.toml'), 'utf8');
			expect(migratedConfigFile).toMatch(/api-key\s*=\s*"test-token"/);
			expect(migratedConfigFile).not.toMatch(/\bdetails\b/);

			const messageFile = await fs.readFile(path.join(migratedConfigDirectory, 'message.md'), 'utf8');
			expect(messageFile).toMatch('Include a body only when the title alone is not sufficient.');
			expect(messageFile).toMatch('use concise markdown without fenced code blocks');

			const legacyBackupFile = await fs.readFile(path.join(fixture.path, '.aicommits.bak'), 'utf8');
			expect(legacyBackupFile).toMatch('details = true');

			await fixture.rm();
		});

		test('fails at runtime when base-url is missing', async () => {
			const { fixture, aicommits } = await createFixture({
				'.aicommits/config.toml': 'api-key = "test-token"',
				'data.json': '1. lorem ipsum',
			});
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const { stderr, stdout, exitCode } = await aicommits([], {
				reject: false,
			});

			expect(exitCode).toBe(1);
			expect(`${stdout}\n${stderr}`).toMatch('Please set your API base URL');

			await fixture.rm();
		});
	});
});
