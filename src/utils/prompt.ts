export type PromptOptions = {
	messageInstructionsMarkdown: string;
	changedFiles?: string[];
	diffWasCompacted?: boolean;
	rewriteFromMessage?: string;
	rewriteFeedback?: string;
	rewriteFeedbackHistory?: string[];
	rewriteConversation?: Array<{
		role: 'assistant' | 'user';
		content: string;
	}>;
};

const getChangedFilesInstruction = (changedFiles?: string[]) => {
	if (!changedFiles || changedFiles.length === 0) {
		return '';
	}

	const normalized = changedFiles
		.map(file => file.trim())
		.filter(Boolean);

	if (normalized.length === 0) {
		return '';
	}

	const shownFiles = normalized.slice(0, 12);
	const extraCount = normalized.length - shownFiles.length;

	return [
		'Changed files:',
		...shownFiles.map(file => `- ${file}`),
		...(extraCount > 0 ? [`- ...and ${extraCount} more file(s)`] : []),
	].join('\n');
};

const getRewriteFeedbackHistory = (options: PromptOptions) => {
	const normalizedHistory = (options.rewriteFeedbackHistory ?? [])
		.map(feedback => feedback.trim())
		.filter(Boolean);

	if (normalizedHistory.length > 0) {
		return normalizedHistory;
	}

	const latestFeedback = options.rewriteFeedback?.trim();
	return latestFeedback ? [latestFeedback] : [];
};

export const generatePrompt = (
	options: PromptOptions,
) => [
	'Generate a git commit message for the provided code diff.',
	'The output will be passed directly into git commit.',
	'Return ONLY the final commit message text.',
	'Do not add explanations, quotes, markdown fences, or surrounding commentary.',
	'You may use the changed file list as supporting context, but the diff is the source of truth.',
	...(options.diffWasCompacted
		? ['The diff may be compacted to fit the model context. Infer the dominant outcome from the available patches without pretending to have seen omitted content.']
		: []),
	getChangedFilesInstruction(options.changedFiles),
	...(
		(options.rewriteConversation ?? []).length > 0
			? [
				'This may be a revision request with prior assistant drafts and user feedback included in the conversation input.',
				'Treat the conversation turns as the canonical rewrite history. Preserve prior accepted constraints unless a later user turn changes them.',
				'Revise the latest assistant draft instead of drafting a completely new message from scratch.',
			]
			: []
	),
	...(
		options.rewriteFromMessage?.trim() && getRewriteFeedbackHistory(options).length > 0
			? [
				'You already suggested a commit message and now need to revise it.',
				[
					'Current suggested commit message:',
					options.rewriteFromMessage.trim(),
				].join('\n'),
				[
					'User rewrite feedback history:',
					...getRewriteFeedbackHistory(options).map((feedback, index) => `${index + 1}. ${feedback}`),
				].join('\n'),
				'For this revision, treat the user rewrite feedback as higher priority than the earlier style or formatting preferences.',
				'Revise the existing commit message instead of drafting a completely new one from scratch. Preserve any parts that still fit the diff unless the feedback requires changing them.',
				'Rewrite the commit message to address the feedback while staying faithful to the diff. If the feedback conflicts with the diff, prefer the diff and revise as closely as possible.',
			]
			: []
	),
	'Markdown instructions:',
	options.messageInstructionsMarkdown.trim(),
].filter(Boolean).join('\n\n');
