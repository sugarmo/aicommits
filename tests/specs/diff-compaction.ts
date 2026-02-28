import { testSuite, expect } from 'manten';
import { compactDiffForPrompt, resolveDiffBudgetChars } from '../../src/utils/openai.js';

const createOversizedPatch = (fileName: string) => [
	`diff --git a/${fileName} b/${fileName}`,
	'index 1111111..2222222 100644',
	`--- a/${fileName}`,
	`+++ b/${fileName}`,
	'@@ -1,1 +1,120 @@',
	...Array.from({ length: 120 }, (_, index) => `+${fileName} line ${index} ${'x'.repeat(48)}`),
].join('\n');

export default testSuite(({ describe, test }) => {
	describe('diff compaction', () => {
		test('uses a conservative default budget when context-window is not configured', () => {
			const budget = resolveDiffBudgetChars();

			expect(budget).toBe(120_000);
		});

		test('increases budget as context-window grows', () => {
			const budget32k = resolveDiffBudgetChars(32_768);
			const budget64k = resolveDiffBudgetChars(65_536);

			expect(budget32k).toBeGreaterThanOrEqual(1024);
			expect(budget64k).toBeGreaterThan(budget32k);
		});

		test('keeps small diffs unchanged', () => {
			const smallDiff = [
				'diff --git a/src/app.ts b/src/app.ts',
				'index 1111111..2222222 100644',
				'--- a/src/app.ts',
				'+++ b/src/app.ts',
				'@@ -1,1 +1,1 @@',
				'+const ok = true;',
			].join('\n');

			const compacted = compactDiffForPrompt(smallDiff, 10_000);

			expect(compacted).toBe(smallDiff);
		});

		test('compacts oversized diffs while retaining multiple file anchors', () => {
			const oversizedDiff = [
				createOversizedPatch('src/alpha.ts'),
				createOversizedPatch('src/beta.ts'),
				createOversizedPatch('src/gamma.ts'),
			].join('\n\n');

			const maxChars = 1100;
			const compacted = compactDiffForPrompt(oversizedDiff, maxChars);

			expect(compacted.length).toBeLessThanOrEqual(maxChars);
			expect(compacted).toMatch('[Diff compacted to fit model context.');
			expect(compacted).toMatch('diff --git a/src/alpha.ts b/src/alpha.ts');
			expect(compacted).toMatch('diff --git a/src/beta.ts b/src/beta.ts');
			expect(compacted).toMatch('diff --git a/src/gamma.ts b/src/gamma.ts');
		});

		test('hard truncates when budget is smaller than compaction notice', () => {
			const oversizedDiff = [
				createOversizedPatch('src/alpha.ts'),
				createOversizedPatch('src/beta.ts'),
			].join('\n\n');
			const compacted = compactDiffForPrompt(oversizedDiff, 20);

			expect(compacted.length).toBeLessThanOrEqual(20);
		});
	});
});
