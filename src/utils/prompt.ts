export type PromptOptions = {
	messageInstructionsMarkdown: string;
	changedFiles?: string[];
	diffWasCompacted?: boolean;
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
	'Markdown instructions:',
	options.messageInstructionsMarkdown.trim(),
].filter(Boolean).join('\n\n');
