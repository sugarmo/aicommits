import path from 'path';
import { execa } from 'execa';
import { testSuite, expect } from 'manten';
import { getDiffForRequest } from '../../src/utils/git.js';
import { createFixture, createGit, files } from '../utils.js';

const createSubmodulePointerChange = async () => {
	const { fixture } = await createFixture({
		'submodule-origin': {
			'README.md': 'submodule source\n',
		},
	});
	const git = await createGit(fixture.path);

	const submoduleOriginPath = path.join(fixture.path, 'submodule-origin');
	const submoduleOriginGit = await createGit(submoduleOriginPath);
	await submoduleOriginGit('add', ['README.md']);
	await submoduleOriginGit('commit', ['-m', 'Initial shared package commit']);

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
	await git('commit', ['-m', 'Add shared package submodule']);

	await fixture.writeFile('submodule-origin/README.md', 'submodule source\nwith payment formatting\n');
	await submoduleOriginGit('add', ['README.md']);
	await submoduleOriginGit('commit', ['-m', 'Add payment formatter']);

	const { stdout: latestSubmoduleCommit } = await submoduleOriginGit('rev-parse', ['HEAD']);
	const submodulePath = path.join(fixture.path, 'SharedPackages');
	await execa('git', ['fetch'], { cwd: submodulePath });
	await execa('git', ['checkout', latestSubmoduleCommit], { cwd: submodulePath });

	return {
		fixture,
		git,
	};
};

export default testSuite(({ describe }) => {
	describe('git', ({ test }) => {
		test('prefers staged changes when staged files exist', async () => {
			const { fixture } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);

			const diff = await getDiffForRequest(undefined, fixture.path);
			expect(diff?.source).toBe('staged');
			expect(diff?.files).toContain('data.json');
			expect(diff?.diff).toMatch('diff --git a/data.json b/data.json');

			await fixture.rm();
		});

		test('falls back to uncommitted changes when no staged files exist', async () => {
			const { fixture } = await createFixture(files);
			const git = await createGit(fixture.path);

			await git('add', ['data.json']);
			await git('commit', ['-m', 'wip']);
			await fixture.writeFile('data.json', 'updated');
			await fixture.writeFile('new-file.ts', 'const value = 1;\n');

			const diff = await getDiffForRequest(undefined, fixture.path);
			expect(diff?.source).toBe('uncommitted');
			expect(diff?.files).toContain('data.json');
			expect(diff?.files).toContain('new-file.ts');
			expect(diff?.diff).toMatch('diff --git a/data.json b/data.json');
			expect(diff?.diff).toMatch('diff --git a/new-file.ts b/new-file.ts');

			await fixture.rm();
		});

		test('does not fallback when staged files exist but are excluded', async () => {
			const { fixture } = await createFixture(files);
			const git = await createGit(fixture.path);

			await fixture.writeFile('fallback.txt', 'fallback');
			await git('add', ['data.json']);

			const diff = await getDiffForRequest(['data.json'], fixture.path);
			expect(diff).toBeUndefined();

			await fixture.rm();
		});

		test('includes staged submodule commit subjects when requested', async () => {
			const { fixture, git } = await createSubmodulePointerChange();

			await git('add', ['SharedPackages']);

			const diff = await getDiffForRequest(undefined, fixture.path, {
				includeSubmoduleCommits: true,
			});
			expect(diff?.source).toBe('staged');
			expect(diff?.files).toContain('SharedPackages');
			expect(diff?.diff).toMatch('Submodule SharedPackages');
			expect(diff?.diff).toMatch('Add payment formatter');

			await fixture.rm();
		});

		test('includes uncommitted submodule commit subjects when requested', async () => {
			const { fixture } = await createSubmodulePointerChange();

			const diff = await getDiffForRequest(undefined, fixture.path, {
				includeSubmoduleCommits: true,
			});
			expect(diff?.source).toBe('uncommitted');
			expect(diff?.files).toContain('SharedPackages');
			expect(diff?.diff).toMatch('Submodule SharedPackages');
			expect(diff?.diff).toMatch('Add payment formatter');

			await fixture.rm();
		});
	});
});
