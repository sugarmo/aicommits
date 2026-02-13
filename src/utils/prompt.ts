import type { CommitType } from './config.js';

export type PromptOptions = {
	includeDetails?: boolean;
	instructions?: string;
	conventionalFormat?: string;
	conventionalTypes?: string;
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
			'Type selection workflow (must run internally before writing the final title):',
			'1) For each candidate type, compute three internal scores from 0-10:',
			'   - EvidenceMatch: how strongly the diff evidence supports this type.',
			'   - TitleBodyConsistency: whether this prefix matches BOTH title semantics and body details.',
			'   - Exclusivity: whether this change is primarily this type (not mixed-purpose).',
			'2) Compute weighted score:',
			'   WeightedScore = (EvidenceMatch * 0.55 + TitleBodyConsistency * 0.30 + Exclusivity * 0.15) * TypeWeight',
			'3) Use these type weights (not equal):',
			'   - refactor: 1.10',
			'   - feat: 1.00',
			'   - fix: 0.80',
			'   - perf: 0.75',
			'   - docs/style/test/build/ci/chore/revert: 0.95',
			'4) Hard gates (strict):',
			'   - Use fix only with explicit defect-correction evidence (wrong behavior, crash, exception, regression, data corruption, bug/defect fix).',
			'   - Never use fix for pure refactor/cleanup/async migration text without explicit bug evidence.',
			'   - Use perf only when the primary and near-exclusive purpose is runtime/memory/latency/throughput improvement.',
			'   - If code-path/structure/API/concurrency-flow changes are central (e.g., completion-to-async/await, actor/cancellation flow changes), choose refactor unless explicit bug-fix evidence dominates.',
			'5) Output only the single best type with the highest valid weighted score.',
			'6) If uncertain between fix and refactor, choose refactor.',
			'Do not output any scores or reasoning; apply this workflow silently.',
		].join('\n');
	}

	return '';
};

const getDetailsInstruction = (
	includeDetails: boolean,
) => {
	if (!includeDetails) {
		return 'Provide only the title, no description or body.';
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
) => {
	if (type === 'conventional') {
		return [
			'Title anchor requirement:',
			'- The commit title must mention at least one concrete anchor from the diff (file, class/type, module, or subsystem).',
			'- Prefer class/type/module/subsystem names over raw file paths when possible.',
			'- If your chosen conventional format supports scope, prefer using the primary file/class/module as scope.',
			'- Avoid titles that only mention function names without file/class context.',
		].join('\n');
	}

	return [
		'Title anchor requirement:',
		'- The commit title must mention at least one concrete anchor from the diff (file, class/type, module, or subsystem).',
		'- Prefer class/type/module/subsystem names over raw file paths when possible.',
		'- Avoid titles that only mention function names without file/class context.',
	].join('\n');
};

export const generatePrompt = (
	locale: string,
	maxLength: number,
	type: CommitType,
	options: PromptOptions = {},
) => {
	const includeDetails = options.includeDetails ?? false;

	return [
		'Generate a concise git commit message in present tense that precisely describes the key changes in the following code diff. Focus on what was changed, not just file names.',
		getDetailsInstruction(includeDetails),
		getLanguageInstruction(locale),
		`Commit title must be a maximum of ${maxLength} characters.`,
		'Exclude anything unnecessary such as translation. Your entire response will be passed directly into git commit.',
		`IMPORTANT: Do not include any explanations, introductions, or additional text. Do not wrap the commit message in quotes or any other formatting. The commit title must not exceed ${maxLength} characters. Respond with ONLY the commit message text.`,
		'Be specific: include concrete details (package names, versions, functionality) rather than generic statements.',
		getChangedFilesInstruction(options.changedFiles),
		getAnchorRequirementInstruction(type),
		getCommitTypeInstruction(type, options.conventionalTypes, options.lockedConventionalType),
		specifyCommitFormat(type, options.conventionalFormat, includeDetails),
		getDefaultStyleInstructions(),
		getCustomInstructions(options.instructions),
	].filter(Boolean).join('\n');
};
