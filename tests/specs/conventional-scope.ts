import { testSuite, expect } from 'manten';
import { stripConventionalScopeFromMessage } from '../../src/utils/openai.js';

export default testSuite(({ describe, test }) => {
	describe('conventional scope', () => {
		test('removes scope from conventional title', () => {
			const normalized = stripConventionalScopeFromMessage(
				'refactor(RecentScrollshotController): Convert detectAndStitch to async/await',
				false,
			);

			expect(normalized).toBe('refactor: Convert detectAndStitch to async/await');
		});

		test('removes scope while preserving body', () => {
			const normalized = stripConventionalScopeFromMessage(
				[
					'feat(RecentScrollshotStore): Add persisted preview cache',
					'',
					'- store preview metadata in SQLite',
				].join('\n'),
				true,
			);

			expect(normalized).toBe([
				'feat: Add persisted preview cache',
				'',
				'- store preview metadata in SQLite',
			].join('\n'));
		});

		test('keeps non-scoped conventional titles unchanged', () => {
			const normalized = stripConventionalScopeFromMessage(
				'fix: Handle nil preview image',
				false,
			);

			expect(normalized).toBe('fix: Handle nil preview image');
		});
	});
});
