import type { CommitType } from './config.js';

export type DetailsStyle = 'paragraph' | 'list';

export type PromptOptions = {
	includeDetails?: boolean;
	detailsStyle?: DetailsStyle;
	instructions?: string;
	conventionalFormat?: string;
	conventionalTypes?: string;
	conventionalScope?: boolean;
	changedFiles?: string[];
	lockedConventionalType?: string;
};

const defaultConventionalTypeDescriptions: Record<string, string> = {
	docs: 'Documentation only changes',
	style: 'Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)',
	refactor: 'A code change that improves code structure without changing functionality (renaming, restructuring classes/methods, extracting functions, etc)',
	perf: 'A code change focused only on performance improvements, with no functional behavior fix and no structural refactor as the primary purpose',
	test: 'Adding missing tests or correcting existing tests',
	build: 'Changes that affect the build system or external dependencies',
	ci: 'Changes to our CI configuration files and scripts',
	chore: "Other changes that don't modify src or test files",
	revert: 'Reverts a previous commit',
	feat: 'A new feature',
	fix: 'A bug fix that corrects incorrect behavior, crashes, exceptions, regressions, or other defects',
};

const commitTypeFormats: Record<CommitType, string> = {
	'': '<commit message>',
	conventional: '<type>[optional (<scope>)]: <commit message>',
};

export const parseConventionalTypes = (rawConventionalTypes?: string) => {
	if (!rawConventionalTypes) {
		return defaultConventionalTypeDescriptions;
	}

	try {
		const parsed = JSON.parse(rawConventionalTypes);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return defaultConventionalTypeDescriptions;
		}

		const entries = Object.entries(parsed as Record<string, unknown>)
			.map(([key, value]) => [key.trim(), String(value).trim()] as const)
			.filter(([key, value]) => key.length > 0 && value.length > 0);

		if (entries.length === 0) {
			return defaultConventionalTypeDescriptions;
		}

		return Object.fromEntries(entries);
	} catch {
		return defaultConventionalTypeDescriptions;
	}
};

const getCommitFormat = (
	type: CommitType,
	conventionalFormat?: string,
) => {
	if (type === 'conventional') {
		return conventionalFormat?.trim() || commitTypeFormats.conventional;
	}

	return commitTypeFormats[type];
};

const specifyCommitFormat = (
	type: CommitType,
	conventionalFormat: string | undefined,
	includeDetails: boolean,
) => (includeDetails
	? `The commit title line must be in format:\n${getCommitFormat(type, conventionalFormat)}`
	: `The output response must be in format:\n${getCommitFormat(type, conventionalFormat)}`);

const getCommitTypeInstruction = (
	type: CommitType,
	conventionalTypes?: string,
	lockedConventionalType?: string,
) => {
	if (type === 'conventional') {
		const normalizedLockedType = lockedConventionalType?.trim();
		if (normalizedLockedType) {
			return [
				`Selected conventional type (locked): ${normalizedLockedType}`,
				'Use this exact type in the title prefix. Do not change it.',
				'The title and body details must stay semantically consistent with this selected type.',
			].join('\n');
		}

		return [
			'Choose a type from the type-to-description JSON below that best describes the git diff:',
			JSON.stringify(parseConventionalTypes(conventionalTypes), null, 2),
			'Select the type directly from the diff intent. Do not run or describe any scoring process.',
			'Type rules:',
			'- fix: use only for explicit bug/defect correction evidence (wrong behavior, crash, exception, regression, data corruption).',
			'- perf: use only when the primary purpose is performance improvement.',
			'- refactor: use for structural/API/concurrency-flow changes without explicit bug-fix evidence.',
			'- If uncertain between fix/perf and refactor, choose refactor.',
			'The selected type must stay semantically consistent with both title and body.',
			'Do not output any type-selection reasoning.',
		].join('\n');
	}

	return '';
};

const getDetailsInstruction = (
	includeDetails: boolean,
	detailsStyle: DetailsStyle,
) => {
	if (!includeDetails) {
		return 'Provide only the title, no description or body.';
	}

	if (detailsStyle === 'list') {
		return [
			'Provide both a title and a body.',
			'Output format must be exactly:',
			'<title>',
			'',
			'<body>',
			'The body must be 3-6 concise bullet points.',
			'Each bullet must start with "- ".',
			'Do not use section labels like "Impact:", "Changes:", "Summary:", or markdown headings.',
			'Each bullet should describe one concrete code-path change with real symbols from the diff.',
		].join('\n');
	}

	return [
		'Provide both a title and a body.',
		'Output format must be exactly:',
		'<title>',
		'',
		'<body>',
		'The body should be 3-6 concise technical prose sentences in one paragraph, not bullet points.',
		'Do not use section labels like "Impact:", "Changes:", "Summary:", or markdown headings.',
		'Describe concrete code-path changes with real symbols from the diff (classes, methods, APIs, actor/threading/cancellation/error-flow changes).',
		'Prefer before/after wording for key behavior changes instead of generic claims.',
	].join('\n');
};

const getDefaultStyleInstructions = () => [
	'Use GitHub Copilot style.',
	'Keep wording concise, technical, and neutral.',
	'Use specific subsystem, class, API, and type names from the diff.',
	'Prefer an imperative, action-led title (for example: Use..., Convert..., Refactor..., Simplify...).',
	'Prioritize concrete change actions and concurrency/correctness context over generic phrasing.',
	'Avoid generic wording like "optimize logic" unless the concrete optimization is explicitly described.',
].join('\n');

const getCustomInstructions = (instructions?: string) => {
	if (!instructions?.trim()) {
		return '';
	}

	return `Additional instructions from user:\n${instructions.trim()}`;
};

const getLanguageInstruction = (locale: string) => [
	`Message language: ${locale}`,
	'You must write the commit message strictly in this language.',
].join('\n');

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

const getAnchorRequirementInstruction = (
	type: CommitType,
	conventionalScope: boolean,
) => {
	if (type === 'conventional') {
		const rules = [
			'Title anchor requirement:',
			'- The commit title must mention at least one concrete anchor from the diff (file, class/type, module, or subsystem).',
			'- Prefer class/type/module/subsystem names over raw file paths when possible.',
			'- Avoid titles that only mention function names without file/class context.',
		];

		if (conventionalScope) {
			rules.push('- For conventional commits, include scope using the primary file/class/module when possible (for example: refactor(RecentScrollshotController): ...).');
			rules.push('- Only omit scope when there is no clear dominant anchor.');
		} else {
			rules.push('- Scope is optional; include it only when it clearly improves clarity.');
		}

		return rules.join('\n');
	}

	return [
		'Title anchor requirement:',
		'- The commit title must mention at least one concrete anchor from the diff (file, class/type, module, or subsystem).',
		'- Prefer class/type/module/subsystem names over raw file paths when possible.',
		'- Avoid titles that only mention function names without file/class context.',
	].join('\n');
};

const getConventionalSubjectInstruction = (
	type: CommitType,
) => {
	if (type !== 'conventional') {
		return '';
	}

	return [
		'Conventional title subject rules:',
		'- The subject text after "<type>(<scope>): " must not start with the same type word.',
		'- Example to avoid: "refactor: refactor ...".',
		'- The selected prefix must stay semantically consistent with the subject action; never output titles like "feat: refactor ..." or "fix: refactor ...".',
		'- For alphabetic languages (for example English), capitalize the first word in the subject.',
		'- Run a final self-check before output: if subject starts with the selected type word, rewrite the subject.',
	].join('\n');
};

export const generatePrompt = (
	locale: string,
	maxLength: number,
	type: CommitType,
	options: PromptOptions = {},
) => {
	const includeDetails = options.includeDetails ?? false;
	const detailsStyle = options.detailsStyle ?? 'paragraph';
	const conventionalScope = options.conventionalScope ?? true;

	return [
		'Generate a concise git commit message in present tense that precisely describes the key changes in the following code diff. Focus on what was changed, not just file names.',
		getDetailsInstruction(includeDetails, detailsStyle),
		getLanguageInstruction(locale),
		`Commit title must be a maximum of ${maxLength} characters.`,
		'Exclude anything unnecessary such as translation. Your entire response will be passed directly into git commit.',
		`IMPORTANT: Do not include any explanations, introductions, or additional text. Do not wrap the commit message in quotes or any other formatting. The commit title must not exceed ${maxLength} characters. Respond with ONLY the commit message text.`,
		'Be specific: include concrete details (package names, versions, functionality) rather than generic statements.',
		getChangedFilesInstruction(options.changedFiles),
		getAnchorRequirementInstruction(type, conventionalScope),
		getConventionalSubjectInstruction(type),
		getCommitTypeInstruction(type, options.conventionalTypes, options.lockedConventionalType),
		specifyCommitFormat(type, options.conventionalFormat, includeDetails),
		getDefaultStyleInstructions(),
		getCustomInstructions(options.instructions),
	].filter(Boolean).join('\n');
};
