import { testSuite, expect } from 'manten';
import { getDiffForRequest } from '../../src/utils/git.js';
import { createFixture, createGit, files } from '../utils.js';

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
	});
});
