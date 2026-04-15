import { expect, testSuite } from 'manten';
import {
	buildCommitMessageInstructions,
	buildCommitMessageResponsesInput,
	buildCommitMessageChatMessages,
} from '../../src/utils/openai.js';

export default testSuite(({ describe, test }) => {
	describe('rewrite feedback prompt plumbing', () => {
		test('passes rewrite feedback history through the generation bridge', () => {
			const instructions = buildCommitMessageInstructions({
				messageInstructionsMarkdown: '# Instructions\n- Use English.\n- Return only the final commit message.',
				rewriteFromMessage: 'feat(cli): add commit message review flow\n\nAdd body details here.',
				rewriteFeedbackHistory: [
					'Do not include detail. Return only a single title line.',
					'Keep the scope as cli.',
				],
			});

			expect(instructions).toMatch('Current suggested commit message:');
			expect(instructions).toMatch('feat(cli): add commit message review flow');
			expect(instructions).toMatch('User rewrite feedback history:');
			expect(instructions).toMatch('1. Do not include detail. Return only a single title line.');
			expect(instructions).toMatch('2. Keep the scope as cli.');
		});

		test('builds chat messages as an actual revision conversation', () => {
			const messages = buildCommitMessageChatMessages(
				'Return only the final commit message text.',
				'diff --git a/src/app.ts b/src/app.ts',
				{
					rewriteConversation: [
						{
							role: 'assistant',
							content: 'feat(cli): add commit message review flow',
						},
						{
							role: 'user',
							content: 'Do not include detail.',
						},
						{
							role: 'assistant',
							content: 'feat(cli): add commit message review flow',
						},
						{
							role: 'user',
							content: 'Keep the scope as cli.',
						},
					],
				},
			);

			expect(messages).toEqual([
				{
					role: 'system',
					content: 'Return only the final commit message text.',
				},
				{
					role: 'user',
					content: 'diff --git a/src/app.ts b/src/app.ts',
				},
				{
					role: 'assistant',
					content: 'feat(cli): add commit message review flow',
				},
				{
					role: 'user',
					content: 'Do not include detail.',
				},
				{
					role: 'assistant',
					content: 'feat(cli): add commit message review flow',
				},
				{
					role: 'user',
					content: 'Keep the scope as cli.',
				},
			]);
		});

		test('builds responses input as an actual revision conversation', () => {
			const input = buildCommitMessageResponsesInput(
				'diff --git a/src/app.ts b/src/app.ts',
				{
					rewriteConversation: [
						{
							role: 'assistant',
							content: 'feat(cli): add commit message review flow',
						},
						{
							role: 'user',
							content: 'Do not include detail.',
						},
						{
							role: 'assistant',
							content: 'feat(tui): add commit message review flow',
						},
						{
							role: 'user',
							content: 'Keep the scope as cli.',
						},
					],
				},
			);

			expect(input).toEqual([
				{
					role: 'user',
					content: 'diff --git a/src/app.ts b/src/app.ts',
				},
				{
					role: 'assistant',
					content: 'feat(cli): add commit message review flow',
				},
				{
					role: 'user',
					content: 'Do not include detail.',
				},
				{
					role: 'assistant',
					content: 'feat(tui): add commit message review flow',
				},
				{
					role: 'user',
					content: 'Keep the scope as cli.',
				},
			]);
		});
	});
});
