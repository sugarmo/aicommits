import {
	isCancel,
	select,
	text,
} from '@clack/prompts';

type PromptResult = {
	status: 'cancelled';
} | {
	status: 'submitted';
	message: string;
} | {
	status: 'rewrite';
	message: string;
	feedback: string;
};

type InternalPromptResult = PromptResult | {
	status: 'back';
};

type PromptDependencies = {
	select: (options: {
		message: string;
		options: Array<{
			value: string;
			label?: string;
			hint?: string;
		}>;
		initialValue?: string;
	}) => Promise<string | symbol>;
	text: (options: {
		message: string;
		placeholder?: string;
		defaultValue?: string;
		initialValue?: string;
		validate?: (value: string) => string | void;
	}) => Promise<string | symbol>;
	isCancel: (value: unknown) => value is symbol;
};

const useMessageValue = '\0use-commit-message';
const rewriteMessageValue = '\0rewrite-commit-message';
const cancelValue = '\0cancel';
const backValue = '\0back';

const promptForRewriteFeedback = async (
	prompts: PromptDependencies,
	message: string,
): Promise<PromptResult> => {
	const feedback = await prompts.text({
		message: 'Tell the AI how to rewrite this commit message:',
		placeholder: 'Example: keep it shorter, mention the scope, and use feat instead of refactor',
		validate(value) {
			if (value.trim().length === 0) {
				return 'Rewrite feedback is required.';
			}
		},
	});

	if (prompts.isCancel(feedback)) {
		return {
			status: 'cancelled',
		};
	}

	return {
		status: 'rewrite',
		message,
		feedback: feedback.trim(),
	};
};

const promptForMessageAction = async (
	prompts: PromptDependencies,
	message: string,
	allowBack: boolean,
): Promise<InternalPromptResult> => {
	const action = await prompts.select({
		message: `Review this commit message:\n\n   ${message}\n`,
		options: [
			{
				label: 'Use this commit message',
				value: useMessageValue,
			},
			{
				label: 'Ask AI to rewrite it',
				hint: 'Give feedback and regenerate',
				value: rewriteMessageValue,
			},
			...(allowBack
				? [{
					label: 'Back to suggestions',
					value: backValue,
				}]
				: []),
			{
				label: 'Cancel',
				value: cancelValue,
			},
		],
	});

	if (prompts.isCancel(action) || action === cancelValue) {
		return {
			status: 'cancelled',
		};
	}

	if (action === backValue) {
		return {
			status: 'back',
		};
	}

	if (action === useMessageValue) {
		return {
			status: 'submitted',
			message,
		};
	}

	return promptForRewriteFeedback(prompts, message);
};

export const resolveCommitMessagePrompt = async (
	messages: string[],
	prompts: PromptDependencies,
): Promise<PromptResult> => {
	if (messages.length === 1) {
		const [message] = messages;
		const result = await promptForMessageAction(prompts, message, false);
		return result.status === 'back'
			? {
				status: 'cancelled',
			}
			: result;
	}

	let reviewingSuggestions = true;
	while (reviewingSuggestions) {
		const selected = await prompts.select({
			message: 'Pick a commit message to review:',
			options: [
				...messages.map(value => ({ label: value, value })),
				{
					label: 'Cancel',
					value: cancelValue,
				},
			],
		});

		if (prompts.isCancel(selected) || selected === cancelValue) {
			return {
				status: 'cancelled',
			};
		}

		const result = await promptForMessageAction(prompts, selected, true);
		if (result.status === 'back') {
			continue;
		}

		reviewingSuggestions = false;
		return result;
	}

	return {
		status: 'cancelled',
	};
};

export const promptForCommitMessage = (messages: string[]) => resolveCommitMessagePrompt(
	messages,
	{
		select,
		text,
		isCancel,
	},
);
