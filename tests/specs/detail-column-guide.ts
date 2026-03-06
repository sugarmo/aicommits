import { expect, testSuite } from 'manten';
import {
	formatDetailedBodyWithColumnGuide,
	formatMarkdownBodyWithColumnGuide,
} from '../../src/utils/openai.js';

const getCodePointLength = (value: string) => Array.from(value).length;

export default testSuite(({ describe, test }) => {
	describe('detail column guide formatting', () => {
		test('wraps paragraph body around configured column', () => {
			const formatted = formatDetailedBodyWithColumnGuide(
				{
					paragraph: 'Align capture orchestration with stitch task lifecycle and preserve cancellation propagation across coordinator boundaries.',
					listItems: [],
				},
				'paragraph',
				36,
			);

			const lines = formatted.split('\n');
			expect(lines.length).toBeGreaterThan(1);
			for (const line of lines) {
				expect(getCodePointLength(line)).toBeLessThanOrEqual(36);
			}
		});

		test('wraps list items with bullet and continuation indentation', () => {
			const formatted = formatDetailedBodyWithColumnGuide(
				{
					paragraph: '',
					listItems: [
						'Update screenshot stitching pipeline to preserve cancellation and reduce coordinator contention under retry bursts.',
						'Keep state sync deterministic.',
					],
				},
				'list',
				32,
			);

			const lines = formatted.split('\n');
			expect(lines[0]?.startsWith('- ')).toBe(true);
			expect(formatted).toMatch('\n  ');
			for (const line of lines) {
				expect(getCodePointLength(line)).toBeLessThanOrEqual(32);
			}
		});

		test('falls back to default guide when value is invalid', () => {
			const text = 'Keep body text readable with a sensible default wrapping width.';
			const formatted = formatDetailedBodyWithColumnGuide(
				{
					paragraph: text,
					listItems: [],
				},
				'paragraph',
				0,
			);

			expect(formatted).toBe(text);
		});

		test('does not split overlong tokens in pure word-wrap mode', () => {
			const longToken = 'supercalifragilisticexpialidocious';
			const formatted = formatDetailedBodyWithColumnGuide(
				{
					paragraph: longToken,
					listItems: [],
				},
				'paragraph',
				16,
			);

			expect(formatted).toBe(longToken);
			expect(getCodePointLength(formatted)).toBeGreaterThan(16);
		});

		test('keeps markdown line layout unchanged', () => {
			const markdown = [
				'### Capture pipeline lifecycle synchronization',
				'- update coordinator ownership and cancellation boundaries for retry-heavy paths',
				'> keep retry flow deterministic',
			].join('\n');
			const narrow = formatMarkdownBodyWithColumnGuide(markdown, 34);
			const wide = formatMarkdownBodyWithColumnGuide(markdown, 120);

			expect(narrow).toBe(markdown);
			expect(wide).toBe(markdown);
		});

		test('upgrades plain markdown body fallback into bullet list', () => {
			const plainBody = [
				'Update coordinator ownership for retry-heavy capture paths.',
				'Preserve cancellation propagation across stitch boundaries.',
			].join('\n');
			const formatted = formatMarkdownBodyWithColumnGuide(plainBody, 72);

			expect(formatted).toBe([
				'- Update coordinator ownership for retry-heavy capture paths.',
				'- Preserve cancellation propagation across stitch boundaries.',
			].join('\n'));
		});
	});
});
