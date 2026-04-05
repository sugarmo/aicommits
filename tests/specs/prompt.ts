import { testSuite, expect } from 'manten';
import { generatePrompt } from '../../src/utils/prompt.js';

export default testSuite(({ describe, test }) => {
	describe('prompt', () => {
		test('builds fixed outer shell around markdown instructions', () => {
			const prompt = generatePrompt({
				messageInstructionsMarkdown: '# Instructions\n- Use English.\n- Return only the final commit message.',
			});

			expect(prompt).toMatch('Generate a git commit message for the provided code diff.');
			expect(prompt).toMatch('Return ONLY the final commit message text.');
			expect(prompt).toMatch('Markdown instructions:');
			expect(prompt).toMatch('# Instructions');
		});

		test('includes changed files as supporting context', () => {
			const prompt = generatePrompt({
				messageInstructionsMarkdown: '# Instructions\n- Use English.',
				changedFiles: [
					'packages/auth/src/x.ts',
					'apps/web/src/a.ts',
				],
			});

			expect(prompt).toMatch('Changed files:');
			expect(prompt).toMatch('packages/auth/src/x.ts');
			expect(prompt).toMatch('apps/web/src/a.ts');
		});

		test('adds compacted diff guidance when needed', () => {
			const prompt = generatePrompt({
				messageInstructionsMarkdown: '# Instructions\n- Use English.',
				diffWasCompacted: true,
			});

			expect(prompt).toMatch('The diff may be compacted to fit the model context.');
		});
	});
});
