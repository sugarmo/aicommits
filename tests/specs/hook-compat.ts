import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import {
	createFixture,
	createGit,
	files,
} from '../utils.js';

export default testSuite(({ describe }) => {
	describe('Git hook compatibility', ({ test }) => {
		test('installs wrapper script', async () => {
			const { fixture, aicommits } = await createFixture(files);
			await createGit(fixture.path);

			const { stdout } = await aicommits(['hook', 'install']);
			expect(stdout).toMatch('Hook installed');

			const hookScriptPath = path.join(fixture.path, '.git/hooks/prepare-commit-msg');
			const hookScriptContent = await fs.readFile(hookScriptPath, 'utf8');
			expect(hookScriptContent).toMatch('process.argv.splice(2, 0, "prepare-commit-msg-hook")');

			await fixture.rm();
		});

		test('can be called through hook command without message path argument', async () => {
			const { fixture, aicommits } = await createFixture(files);
			await createGit(fixture.path);

			const { exitCode, stderr, stdout } = await aicommits(['prepare-commit-msg-hook'], { reject: false });
			expect(exitCode).toBe(0);
			expect(stdout).toBe('');
			expect(stderr).not.toMatch('Commit message file path is missing');
			expect(stderr).toBe('');

			await fixture.rm();
		});
	});
});
