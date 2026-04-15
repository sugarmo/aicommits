import { expect, testSuite } from 'manten';
import { resolveCommitMessagePrompt } from '../../src/utils/commit-message-prompt.js';

const cancelled = Symbol('cancelled');

const createPrompts = ({
	selectResults = [],
	textResult = 'Mention cli scope and keep it shorter',
}: {
	selectResults?: Array<string | symbol>;
	textResult?: string | symbol;
} = {}) => {
	const calls = {
		select: [] as Array<{
			message: string;
			options: Array<{
				value: string;
				label?: string;
				hint?: string;
			}>;
		}>,
		text: [] as Array<{
			message: string;
			placeholder?: string;
			initialValue?: string;
		}>,
	};
	let selectIndex = 0;

	return {
		calls,
		prompts: {
			select: async (options: {
				message: string;
				options: Array<{
					value: string;
					label?: string;
					hint?: string;
				}>;
			}) => {
				calls.select.push(options);
				const next = selectResults[selectIndex];
				selectIndex += 1;
				return next ?? options.options[0]?.value ?? cancelled;
			},
			text: async (options: {
				message: string;
				placeholder?: string;
				initialValue?: string;
			}) => {
				calls.text.push(options);
				return textResult;
			},
			isCancel: (value: unknown): value is symbol => value === cancelled,
		},
	};
};

export default testSuite(({ describe, test }) => {
	describe('commit message prompt flow', () => {
		test('keeps the AI message when the current suggestion is accepted', async () => {
			const { calls, prompts } = createPrompts();
			const result = await resolveCommitMessagePrompt(['fix(cli): keep the generated title'], prompts);

			expect(result).toEqual({
				status: 'submitted',
				message: 'fix(cli): keep the generated title',
			});
			expect(calls.text.length).toBe(0);
		});

		test('requests rewrite feedback for a single generated message', async () => {
			const { calls, prompts } = createPrompts({
				selectResults: ['\0rewrite-commit-message'],
				textResult: 'Mention the scope and switch to feat',
			});
			const result = await resolveCommitMessagePrompt(['refactor: improve commit message flow'], prompts);

			expect(result).toEqual({
				status: 'rewrite',
				message: 'refactor: improve commit message flow',
				feedback: 'Mention the scope and switch to feat',
			});
			expect(calls.select[0]?.options).toEqual([
				{
					label: 'Use this commit message',
					value: '\0use-commit-message',
				},
				{
					label: 'Ask AI to rewrite it',
					hint: 'Give feedback and regenerate',
					value: '\0rewrite-commit-message',
				},
				{
					label: 'Cancel',
					value: '\0cancel',
				},
			]);
		});

		test('lets the user pick one suggestion and request a rewrite', async () => {
			const { calls, prompts } = createPrompts({
				selectResults: [
					'feat(cli): add candidate selection',
					'\0rewrite-commit-message',
				],
				textResult: 'Keep feat, but mention TUI review flow',
			});
			const result = await resolveCommitMessagePrompt([
				'fix(cli): keep the default flow',
				'feat(cli): add candidate selection',
			], prompts);

			expect(result).toEqual({
				status: 'rewrite',
				message: 'feat(cli): add candidate selection',
				feedback: 'Keep feat, but mention TUI review flow',
			});
			expect(calls.select[1]?.options).toEqual([
				{
					label: 'Use this commit message',
					value: '\0use-commit-message',
				},
				{
					label: 'Ask AI to rewrite it',
					hint: 'Give feedback and regenerate',
					value: '\0rewrite-commit-message',
				},
				{
					label: 'Back to suggestions',
					value: '\0back',
				},
				{
					label: 'Cancel',
					value: '\0cancel',
				},
			]);
		});

		test('returns cancelled when the rewrite feedback prompt is aborted', async () => {
			const { prompts } = createPrompts({
				selectResults: ['\0rewrite-commit-message'],
				textResult: cancelled,
			});
			const result = await resolveCommitMessagePrompt(['fix(cli): generated title'], prompts);

			expect(result).toEqual({
				status: 'cancelled',
			});
		});
	});
});
