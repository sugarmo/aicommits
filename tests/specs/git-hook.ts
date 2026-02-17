import fs from 'fs/promises';
import path from 'path';
import { execa } from 'execa';
import { testSuite, expect } from 'manten';
import {
	createFixture,
	createGit,
	files,
	hasLiveTestProviderConfig,
	warnSkippedLiveTests,
} from '../utils.js';

export default testSuite(({ describe }) => {
	describe('Git hook', ({ test }) => {
		test('errors when not in Git repo', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const { exitCode, stderr } = await aicommits(['hook', 'install'], {
				reject: false,
			});

			expect(exitCode).toBe(1);
			expect(stderr).toMatch('The current directory must be a Git repository');

			await fixture.rm();
		});

		test('installs from Git repo subdirectory', async () => {
			const { fixture, aicommits } = await createFixture({
				...files,
				'some-dir': {
					'file.txt': '',
				},
			});
			await createGit(fixture.path);

			const { stdout } = await aicommits(['hook', 'install'], {
				cwd: path.join(fixture.path, 'some-dir'),
			});
			expect(stdout).toMatch('Hook installed');

			expect(await fixture.exists('.git/hooks/prepare-commit-msg')).toBe(true);

			await fixture.rm();
		});

		test('installs in Git submodule', async () => {
			const { fixture, aicommits } = await createFixture({
				...files,
				'submodule-origin': {
					'README.md': 'submodule source',
				},
			});
			const git = await createGit(fixture.path);

			const submoduleOriginPath = path.join(fixture.path, 'submodule-origin');
			const submoduleOriginGit = await createGit(submoduleOriginPath);
			await submoduleOriginGit('add', ['README.md']);
			await submoduleOriginGit('commit', ['-m', 'Initial submodule commit']);

			await git(
				'submodule',
				[
					'add',
					submoduleOriginPath,
					'SharedPackages',
				],
				{
					env: {
						GIT_ALLOW_PROTOCOL: 'file',
					},
				},
			);

			const submodulePath = path.join(fixture.path, 'SharedPackages');
			const { stdout } = await aicommits(['hook', 'install'], {
				cwd: submodulePath,
			});
			expect(stdout).toMatch('Hook installed');

			const { stdout: hooksPathOutput } = await execa(
				'git',
				['rev-parse', '--git-path', 'hooks'],
				{
					cwd: submodulePath,
				},
			);
			const hooksPath = (
				path.isAbsolute(hooksPathOutput)
					? hooksPathOutput
					: path.resolve(submodulePath, hooksPathOutput)
			);
			const hookScriptPath = path.join(hooksPath, 'prepare-commit-msg');
			const hookScriptContent = await fs.readFile(hookScriptPath, 'utf8');
			expect(hookScriptContent).toMatch('process.argv.splice(2, 0, "prepare-commit-msg-hook")');

			await fixture.rm();
		});

		if (!hasLiveTestProviderConfig()) {
			warnSkippedLiveTests('Git hook commit generation');
			return;
		}

		test('Commits', async () => {
			const { fixture, aicommits } = await createFixture(files);
			const git = await createGit(fixture.path);

			const { stdout } = await aicommits(['hook', 'install']);
			expect(stdout).toMatch('Hook installed');

			await git('add', ['data.json']);
			await git('commit', ['--no-edit'], {
				env: {
					HOME: fixture.path,
					USERPROFILE: fixture.path,
				},
			});

			const { stdout: commitMessage } = await git('log', ['--pretty=%B']);
			console.log('Committed with:', commitMessage);
			expect(commitMessage.startsWith('# ')).not.toBe(true);

			await fixture.rm();
		});
	});
});
