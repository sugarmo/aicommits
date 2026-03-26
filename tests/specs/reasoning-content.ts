import { expect, testSuite } from 'manten';
import {
	separateReasoningBlocks,
	stripReasoningBlocksFromContent,
} from '../../src/utils/openai.js';

export default testSuite(({ describe, test }) => {
	describe('reasoning content separation', () => {
		test('strips think blocks from final content', () => {
			const content = stripReasoningBlocksFromContent([
				'<think>I should compare changed modules first.</think>',
				'fix: Keep generation output focused on final commit text',
			].join('\n'));

			expect(content).toBe('\nfix: Keep generation output focused on final commit text');
		});

		test('separates streamed think blocks across chunk boundaries', () => {
			const separated = separateReasoningBlocks([
				'<th',
				'ink>Need to inspect the diff before drafting.</th',
				'ink>feat: Move heavy analysis off the main thread',
			]);

			expect(separated.reasoning).toBe('Need to inspect the diff before drafting.');
			expect(separated.content).toBe('feat: Move heavy analysis off the main thread');
		});

		test('keeps plain content unchanged when no think block exists', () => {
			const separated = separateReasoningBlocks([
				'refactor: Preserve cancellation flow in capture pipeline',
			]);

			expect(separated.reasoning).toBe('');
			expect(separated.content).toBe('refactor: Preserve cancellation flow in capture pipeline');
		});
	});
});
