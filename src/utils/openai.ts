import https, { type RequestOptions } from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import type { CreateChatCompletionRequest, CreateChatCompletionResponse } from 'openai';
import {
	type TiktokenModel,
} from '@dqbd/tiktoken';
import createHttpsProxyAgent from 'https-proxy-agent';
import { KnownError } from './error.js';
import type { CommitType } from './config.js';
import { generatePrompt, parseConventionalTypes, type PromptOptions } from './prompt.js';

const httpsPost = async (
	hostname: string,
	path: string,
	headers: Record<string, string>,
	json: unknown,
	timeout: number,
	proxy?: string,
) => new Promise<{
	request: ClientRequest;
	response: IncomingMessage;
	data: string;
}>((resolve, reject) => {
	const postContent = JSON.stringify(json);

	const options: RequestOptions = {
		port: 443,
		hostname,
		path,
		method: 'POST',
		headers: {
			...headers,
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(postContent),
		},
		timeout,
		agent: (
			proxy
				? createHttpsProxyAgent(proxy) as any
				: undefined
		),
	};

	const request = https.request(
		options,
		(response) => {
			const body: Buffer[] = [];
			response.on('data', chunk => body.push(chunk));
			response.on('end', () => {
				resolve({
					request,
					response,
					data: Buffer.concat(body).toString(),
				});
			});
		},
	);
	request.on('error', reject);
	request.on('timeout', () => {
		request.destroy();
		reject(new KnownError(`Time out error: request took over ${timeout}ms. Try increasing the \`timeout\` config, or checking the OpenAI API status https://status.openai.com`));
	});

	request.write(postContent);
	request.end();
});

const createChatCompletion = async (
	apiKey: string,
	json: CreateChatCompletionRequest,
	timeout: number,
	proxy?: string,
) => {
	const { response, data } = await httpsPost(
		'api.openai.com',
		'/v1/chat/completions',
		{
			Authorization: `Bearer ${apiKey}`,
		},
		json,
		timeout,
		proxy,
	);

	if (
		!response.statusCode
		|| response.statusCode < 200
		|| response.statusCode > 299
	) {
		let errorMessage = `OpenAI API Error: ${response.statusCode} - ${response.statusMessage}`;

		if (data) {
			errorMessage += `\n\n${data}`;
		}

		if (response.statusCode === 500) {
			errorMessage += '\n\nCheck the API status: https://status.openai.com';
		}

		throw new KnownError(errorMessage);
	}

	return JSON.parse(data) as CreateChatCompletionResponse;
};

const normalizeLineEndings = (text: string) => text.replace(/\r\n?/g, '\n');

const stripCodeFences = (text: string) => {
	const fencedContent = text.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/);

	if (fencedContent?.[1]) {
		return fencedContent[1].trim();
	}

	return text.replace(/```/g, '').trim();
};

const sanitizeTitle = (title: string) => title
	.trim()
	.replace(/^title:\s*/i, '')
	.replace(/(\w)\.$/, '$1')
	.replace(/^["'`]|["'`]$/g, '');

const stripBodyLabels = (text: string) => text
	.replace(/^\s*(body|description|details)\s*:\s*/i, '')
	.replace(/^\s*(主要改动包括|主要改动|改动包括)\s*[:：]\s*/i, '')
	.replace(/^\s*(impact|影响)\s*[:：]\s*/i, '');

const normalizeDetailedBody = (body: string) => {
	if (!body.trim()) {
		return '';
	}

	const lines = body
		.split('\n')
		.map(line => stripBodyLabels(line.trim()))
		.filter(Boolean);

	if (lines.length === 0) {
		return '';
	}

	const bulletLines: string[] = [];
	const proseLines: string[] = [];

	for (const line of lines) {
		const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
		if (bullet?.[1]) {
			bulletLines.push(bullet[1].trim());
		} else {
			proseLines.push(line.trim());
		}
	}

	const normalized = [
		...proseLines,
		...bulletLines,
	]
		.join(' ')
		.replace(/\s{2,}/g, ' ')
		.replace(/\s+([,.;:!?])/g, '$1')
		.trim();

	return normalized;
};

const splitCommitMessage = (message: string) => {
	const normalized = normalizeLineEndings(message).trim();
	if (!normalized) {
		return {
			title: '',
			body: '',
		};
	}

	const lines = normalized
		.split('\n')
		.map(line => line.replace(/\s+$/g, ''));

	while (lines[0]?.trim() === '') {
		lines.shift();
	}

	const title = sanitizeTitle(lines.shift() || '');

	while (lines[0]?.trim() === '') {
		lines.shift();
	}

	if (lines[0]?.trim().toLowerCase().startsWith('body:')) {
		lines[0] = lines[0].replace(/^body:\s*/i, '');
	}

	const body = lines.join('\n').trim();

	return {
		title,
		body,
	};
};

const formatCommitMessage = (title: string, body: string) => (
	body
		? `${title}\n\n${body}`
		: title
);

const sanitizeSimpleMessage = (message: string) => sanitizeTitle(
	stripCodeFences(message)
		.trim()
		.split('\n')[0] || '',
);

const sanitizeDetailedMessage = (message: string) => {
	const cleaned = stripCodeFences(message);
	const { title, body } = splitCommitMessage(cleaned);
	const normalizedBody = normalizeDetailedBody(body);

	return formatCommitMessage(title, normalizedBody);
};

const sanitizeMessage = (
	message: string,
	includeDetails: boolean,
) => {
	if (includeDetails) {
		return sanitizeDetailedMessage(message);
	}

	return sanitizeSimpleMessage(message);
};

type ScoreWeightCategory = 'refactor' | 'feat' | 'fix' | 'perf' | 'other';
type JudgeTypeScore = {
	evidenceMatch: number;
	titleBodyConsistency: number;
	exclusivity: number;
	hardGatePass: boolean;
};
export type ConventionalTypeScoreCandidate = {
	typeName: string;
	weightCategory: ScoreWeightCategory;
	evidenceMatch: number;
	titleBodyConsistency: number;
	exclusivity: number;
	hardGatePass: boolean;
	modelHardGatePass: boolean;
	weightedScore: number;
	baseScore: number;
	typeWeight: number;
};
export type ConventionalTypeJudgeReport = {
	source: 'topCandidates' | 'scores';
	selectedType?: string;
	topCandidates: ConventionalTypeScoreCandidate[];
};
export type GenerateCommitMessageOptions = PromptOptions & {
	onConventionalTypeScored?: (report: ConventionalTypeJudgeReport) => void;
};

const judgeTypeWeights: Record<ScoreWeightCategory, number> = {
	refactor: 1.10,
	feat: 1.00,
	fix: 0.80,
	perf: 0.75,
	other: 0.95,
};

const scoreEpsilon = 1e-6;

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
	typeof value === 'object'
	&& value !== null
	&& !Array.isArray(value)
);

const clampScore0to10 = (value: unknown) => {
	const numeric = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(numeric)) {
		return undefined;
	}

	return Math.max(0, Math.min(10, numeric));
};

const normalizeKey = (value: string) => value.trim().toLowerCase();

const extractJsonObjectText = (raw: string) => {
	const cleaned = stripCodeFences(raw).trim();
	if (!cleaned) {
		return undefined;
	}

	const firstBrace = cleaned.indexOf('{');
	const lastBrace = cleaned.lastIndexOf('}');
	if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
		return undefined;
	}

	return cleaned.slice(firstBrace, lastBrace + 1);
};

const readNumberField = (
	record: Record<string, unknown>,
	keys: string[],
) => {
	for (const key of keys) {
		if (!(key in record)) {
			continue;
		}

		const parsed = clampScore0to10(record[key]);
		if (parsed !== undefined) {
			return parsed;
		}
	}

	return undefined;
};

const readBooleanField = (
	record: Record<string, unknown>,
	keys: string[],
) => {
	for (const key of keys) {
		if (!(key in record)) {
			continue;
		}

		const value = record[key];
		if (typeof value === 'boolean') {
			return value;
		}

		if (typeof value === 'string') {
			const normalized = value.trim().toLowerCase();
			if (['true', 'yes', '1', 'pass', 'passed'].includes(normalized)) {
				return true;
			}

			if (['false', 'no', '0', 'fail', 'failed'].includes(normalized)) {
				return false;
			}
		}
	}

	return undefined;
};

const parseJudgeTypeScore = (value: unknown): JudgeTypeScore | undefined => {
	if (!isObjectRecord(value)) {
		return undefined;
	}

	const evidenceMatch = readNumberField(
		value,
		['evidenceMatch', 'evidence', 'evidenceScore', 'evidence_score'],
	);
	const titleBodyConsistency = readNumberField(
		value,
		['titleBodyConsistency', 'consistency', 'title_body_consistency', 'consistencyScore'],
	);
	const exclusivity = readNumberField(
		value,
		['exclusivity', 'exclusive', 'exclusivityScore', 'exclusivity_score'],
	);
	const hardGatePass = readBooleanField(
		value,
		['hardGatePass', 'hardGate', 'hard_gate_pass', 'passesHardGate'],
	);

	if (
		evidenceMatch === undefined
		|| titleBodyConsistency === undefined
		|| exclusivity === undefined
		|| hardGatePass === undefined
	) {
		return undefined;
	}

	return {
		evidenceMatch,
		titleBodyConsistency,
		exclusivity,
		hardGatePass,
	};
};

const parseJudgeTopCandidates = (
	value: unknown,
	allowedTypes: string[],
) => {
	if (!Array.isArray(value)) {
		return Object.create(null) as Record<string, unknown>;
	}

	const allowedTypeMap = new Map(
		allowedTypes.map(typeName => [normalizeKey(typeName), typeName] as const),
	);
	const scoresByType = Object.create(null) as Record<string, unknown>;

	for (const candidate of value) {
		if (!isObjectRecord(candidate)) {
			continue;
		}

		const rawType = candidate.type;
		if (typeof rawType !== 'string') {
			continue;
		}

		const matchedType = allowedTypeMap.get(normalizeKey(rawType));
		if (!matchedType || matchedType in scoresByType) {
			continue;
		}

		scoresByType[matchedType] = candidate;

		if (Object.keys(scoresByType).length >= 3) {
			break;
		}
	}

	return scoresByType;
};

const inferScoreWeightCategory = (
	typeName: string,
	description: string,
): ScoreWeightCategory => {
	const normalizedTypeName = normalizeKey(typeName);
	if (normalizedTypeName === 'refactor') {
		return 'refactor';
	}

	if (normalizedTypeName === 'feat' || normalizedTypeName === 'feature') {
		return 'feat';
	}

	if (normalizedTypeName === 'fix' || normalizedTypeName === 'bugfix') {
		return 'fix';
	}

	if (normalizedTypeName === 'perf' || normalizedTypeName === 'performance') {
		return 'perf';
	}

	const text = `${typeName} ${description}`.toLowerCase();

	if (/\brefactor\b|重构|重组|结构优化|cleanup|clean up|async|await/.test(text)) {
		return 'refactor';
	}

	if (/\bfeat\b|\bfeature\b|新增|新功能|引入/.test(text)) {
		return 'feat';
	}

	if (/\bfix\b|\bbug\b|缺陷|错误|崩溃|异常|回归|修复/.test(text)) {
		return 'fix';
	}

	if (/\bperf\b|\bperformance\b|性能|提速|加速|吞吐|延迟|内存/.test(text)) {
		return 'perf';
	}

	return 'other';
};

const getRankedTypesByJudgeScores = (
	conventionalTypes: Record<string, string>,
	scoresByTypeRaw: Record<string, unknown>,
) => {
	const normalizedScoreMap = new Map<string, unknown>();
	for (const [key, value] of Object.entries(scoresByTypeRaw)) {
		normalizedScoreMap.set(normalizeKey(key), value);
	}

	const ranked: ConventionalTypeScoreCandidate[] = [];

	for (const [typeName, description] of Object.entries(conventionalTypes)) {
		const rawScore = normalizedScoreMap.get(normalizeKey(typeName));
		const score = parseJudgeTypeScore(rawScore);
		if (!score) {
			continue;
		}

		const weightCategory = inferScoreWeightCategory(typeName, description);
		const typeWeight = judgeTypeWeights[weightCategory];
		const modelHardGatePass = score.hardGatePass;
		const hardGatePass = (
			weightCategory === 'fix'
			|| weightCategory === 'perf'
		)
			? modelHardGatePass
			: true;
		const baseScore = (
			(score.evidenceMatch * 0.55)
			+ (score.titleBodyConsistency * 0.30)
			+ (score.exclusivity * 0.15)
		);
		const weightedScore = baseScore * typeWeight;

		ranked.push({
			typeName,
			weightCategory,
			evidenceMatch: score.evidenceMatch,
			titleBodyConsistency: score.titleBodyConsistency,
			exclusivity: score.exclusivity,
			hardGatePass,
			modelHardGatePass,
			weightedScore,
			baseScore,
			typeWeight,
		});
	}

	ranked.sort((a, b) => {
		if (a.hardGatePass !== b.hardGatePass) {
			return a.hardGatePass ? -1 : 1;
		}

		if (b.weightedScore - a.weightedScore > scoreEpsilon) {
			return 1;
		}

		if (a.weightedScore - b.weightedScore > scoreEpsilon) {
			return -1;
		}

		return b.typeWeight - a.typeWeight;
	});

	return ranked;
};

const buildConventionalTypeJudgeReport = (
	conventionalTypes: Record<string, string>,
	scoresByTypeRaw: Record<string, unknown>,
	source: ConventionalTypeJudgeReport['source'],
): ConventionalTypeJudgeReport => {
	const ranked = getRankedTypesByJudgeScores(
		conventionalTypes,
		scoresByTypeRaw,
	);

	const selectedType = (
		ranked.find(item => item.hardGatePass)
		|| ranked.find(item => item.weightCategory !== 'fix' && item.weightCategory !== 'perf')
		|| ranked[0]
	)?.typeName;

	return {
		source,
		selectedType,
		topCandidates: ranked.slice(0, 3),
	};
};

const selectLockedConventionalType = async (
	apiKey: string,
	model: TiktokenModel,
	diff: string,
	timeout: number,
	proxy: string | undefined,
	conventionalTypesRaw: string | undefined,
) => {
	const conventionalTypes = parseConventionalTypes(conventionalTypesRaw);
	const allowedTypes = Object.keys(conventionalTypes);
	if (allowedTypes.length === 0) {
		return undefined;
	}

	const request: CreateChatCompletionRequest = {
		model,
		messages: [
			{
				role: 'system',
				content: [
					'You are selecting the best conventional commit type using structured scoring.',
					`Allowed type keys: ${allowedTypes.join(', ')}`,
					'Score candidate types and return ONLY the top 3 highest-scoring types.',
					'For each returned type, score 0-10 on:',
					'- evidenceMatch',
					'- titleBodyConsistency',
					'- exclusivity',
					'Also provide hardGatePass (true/false).',
					'Hard gates:',
					'- fix requires explicit defect-fix evidence (wrong behavior, crash, exception, regression, bug/defect).',
					'- perf requires near-exclusive performance intent.',
					'- async/await migration and API/concurrency-flow restructuring should prefer refactor unless explicit bug-fix evidence dominates.',
					'Return ONLY JSON in this shape (no markdown, no prose):',
					'{"topCandidates":[{"type":"refactor","evidenceMatch":0,"titleBodyConsistency":0,"exclusivity":0,"hardGatePass":true}]}',
					'Rules for output:',
					'- topCandidates must be sorted from highest to lowest confidence.',
					'- Include at most 3 items.',
					'- type must be one of allowed type keys.',
				].join('\n'),
			},
			{
				role: 'user',
				content: diff,
			},
		],
		top_p: 1,
		frequency_penalty: 0,
		presence_penalty: 0,
		max_tokens: 420,
		stream: false,
		n: 1,
	};

	const completion = await createChatCompletion(
		apiKey,
		request,
		timeout,
		proxy,
	);

	const judgeMessage = completion.choices
		.map(choice => choice.message?.content)
		.find((content): content is string => typeof content === 'string');
	if (!judgeMessage) {
		return undefined;
	}

	const judgeJsonText = extractJsonObjectText(judgeMessage);
	if (!judgeJsonText) {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(judgeJsonText);
	} catch {
		return undefined;
	}

	if (!isObjectRecord(parsed)) {
		return undefined;
	}

	const topCandidateScores = parseJudgeTopCandidates(parsed.topCandidates, allowedTypes);
	const candidateCount = Object.keys(topCandidateScores).length;
	if (candidateCount > 0) {
		return buildConventionalTypeJudgeReport(
			conventionalTypes,
			topCandidateScores,
			'topCandidates',
		);
	}

	if (!isObjectRecord(parsed.scores)) {
		return undefined;
	}

	return buildConventionalTypeJudgeReport(
		conventionalTypes,
		parsed.scores,
		'scores',
	);
};

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));
const chineseCharacterPattern = /[\u3400-\u9fff]/;
const conventionalTitlePrefixPattern = /^([a-z]+(?:\([^)]+\))?:\s*)(.+)$/i;

const isChineseLocale = (locale: string) => {
	const normalized = locale.trim().toLowerCase();
	return normalized === 'cn' || normalized.startsWith('zh');
};

const splitConventionalTitle = (title: string) => {
	const match = title.match(conventionalTitlePrefixPattern);
	if (!match) {
		return {
			prefix: '',
			subject: title.trim(),
		};
	}

	return {
		prefix: match[1],
		subject: (match[2] || '').trim(),
	};
};

const shouldRewriteTitleToLocale = (
	title: string,
	locale: string,
) => {
	if (!isChineseLocale(locale)) {
		return false;
	}

	const { subject } = splitConventionalTitle(title);
	if (subject.length === 0) {
		return false;
	}

	return !chineseCharacterPattern.test(subject);
};

const rewriteTitleToLocale = async (
	apiKey: string,
	model: TiktokenModel,
	locale: string,
	title: string,
	maxLength: number,
	timeout: number,
	proxy?: string,
	temperature?: number,
) => {
	const { prefix, subject } = splitConventionalTitle(title);

	const request: CreateChatCompletionRequest = {
		model,
		messages: [
			{
				role: 'system',
				content: [
					`Rewrite ONLY this commit title into locale "${locale}".`,
					'Keep technical meaning unchanged and keep wording concise.',
					`Maximum title length: ${maxLength} characters.`,
					'Return only the rewritten title text. No quotes, no code fences, no explanations.',
					...(prefix ? [`Preserve this conventional prefix exactly: "${prefix}" and rewrite only the subject part.`] : []),
				].join('\n'),
			},
			{
				role: 'user',
				content: title,
			},
		],
		top_p: 1,
		frequency_penalty: 0,
		presence_penalty: 0,
		max_tokens: 120,
		stream: false,
		n: 1,
	};

	if (temperature !== undefined) {
		request.temperature = temperature;
	}

	const completion = await createChatCompletion(
		apiKey,
		request,
		timeout,
		proxy,
	);

	const rewritten = completion.choices
		.map(choice => choice.message?.content)
		.find(content => typeof content === 'string');

	if (!rewritten) {
		return title;
	}

	const sanitized = sanitizeSimpleMessage(rewritten);
	if (!sanitized) {
		return title;
	}

	if (!prefix) {
		return sanitized;
	}

	const sanitizedSubject = sanitized
		.replace(conventionalTitlePrefixPattern, '$2')
		.trim();

	return `${prefix}${sanitizedSubject || subject}`;
};

const enforceTitleLocale = async (
	apiKey: string,
	model: TiktokenModel,
	locale: string,
	message: string,
	includeDetails: boolean,
	maxLength: number,
	timeout: number,
	proxy?: string,
	temperature?: number,
) => {
	const { title, body } = includeDetails
		? splitCommitMessage(message)
		: { title: message.trim(), body: '' };

	if (!shouldRewriteTitleToLocale(title, locale)) {
		return message;
	}

	try {
		const rewrittenTitle = await rewriteTitleToLocale(
			apiKey,
			model,
			locale,
			title,
			maxLength,
			timeout,
			proxy,
			temperature,
		);
		return includeDetails
			? formatCommitMessage(rewrittenTitle, body)
			: rewrittenTitle;
	} catch {
		// Keep original message when rewrite fails.
		return message;
	}
};

export const generateCommitMessage = async (
	apiKey: string,
	model: TiktokenModel,
	locale: string,
	diff: string,
	completions: number,
	maxLength: number,
	type: CommitType,
	timeout: number,
	proxy?: string,
	options: GenerateCommitMessageOptions = {},
	temperature?: number,
) => {
	const includeDetails = options.includeDetails ?? false;
	let lockedConventionalType: string | undefined;

	if (type === 'conventional') {
		try {
			const judgeReport = await selectLockedConventionalType(
				apiKey,
				model,
				diff,
				timeout,
				proxy,
				options.conventionalTypes,
			);
			lockedConventionalType = judgeReport?.selectedType;
			if (judgeReport) {
				options.onConventionalTypeScored?.(judgeReport);
			}
		} catch {
			// Fall back to single-pass generation if type selection fails.
		}
	}

	const promptOptions: PromptOptions = {
		includeDetails: options.includeDetails,
		instructions: options.instructions,
		conventionalFormat: options.conventionalFormat,
		conventionalTypes: options.conventionalTypes,
		changedFiles: options.changedFiles,
		lockedConventionalType,
	};

	const request: CreateChatCompletionRequest = {
		model,
		messages: [
			{
				role: 'system',
				content: generatePrompt(locale, maxLength, type, promptOptions),
			},
			{
				role: 'user',
				content: diff,
			},
		],
		top_p: 1,
		frequency_penalty: 0,
		presence_penalty: 0,
		max_tokens: includeDetails ? 420 : 200,
		stream: false,
		n: completions,
	};

	if (temperature !== undefined) {
		request.temperature = temperature;
	}

	try {
		const completion = await createChatCompletion(
			apiKey,
			request,
			timeout,
			proxy,
		);

		const messages = completion.choices
			.flatMap((choice) => {
				const content = choice.message?.content;
				if (typeof content !== 'string') {
					return [];
				}

				return [sanitizeMessage(content, includeDetails)];
			})
			.filter(Boolean);

		const localizedMessages = await Promise.all(
			messages.map(message => enforceTitleLocale(
				apiKey,
				model,
				locale,
				message,
				includeDetails,
				maxLength,
				timeout,
				proxy,
				temperature,
			)),
		);

		return deduplicateMessages(
			localizedMessages
				.filter(Boolean),
		);
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`);
		}

		throw errorAsAny;
	}
};
