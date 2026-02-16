import https, { type RequestOptions } from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import type { CreateChatCompletionRequest, CreateChatCompletionResponse } from 'openai';
import {
	type TiktokenModel,
} from '@dqbd/tiktoken';
import createHttpsProxyAgent from 'https-proxy-agent';
import { KnownError } from './error.js';
import type { CommitType } from './config.js';
import {
	generatePrompt,
	parseConventionalTypes,
	type DetailsStyle,
	type PromptOptions,
} from './prompt.js';

type CompletionStreamEvent = {
	kind: 'reasoning' | 'content';
	text: string;
};

type CompletionStreamCallback = (event: CompletionStreamEvent) => void;

const httpsPost = async (
	hostname: string,
	path: string,
	headers: Record<string, string>,
	json: unknown,
	timeout: number,
	proxy?: string,
	port?: number,
	onChunk?: (chunk: string) => void,
) => new Promise<{
	request: ClientRequest;
	response: IncomingMessage;
	data: string;
}>((resolve, reject) => {
	const postContent = JSON.stringify(json);

	const options: RequestOptions = {
		port: port ?? 443,
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
			response.on('data', (chunk: Buffer) => {
				body.push(chunk);
				onChunk?.(chunk.toString());
			});
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
		reject(new KnownError(`Time out error: request took over ${timeout}ms. Try increasing the \`timeout\` config, or checking your API provider status.`));
	});

	request.write(postContent);
	request.end();
});

const resolveChatCompletionsEndpoint = (baseUrl?: string) => {
	if (!baseUrl?.trim()) {
		throw new KnownError('Please set your API base URL via `aicommits config set base-url=<https://...>`');
	}

	const normalized = baseUrl.trim();
	const parsed = new URL(normalized);
	const normalizedPath = parsed.pathname.replace(/\/+$/, '');

	return {
		hostname: parsed.hostname,
		port: parsed.port ? Number(parsed.port) : 443,
		path: `${normalizedPath}/chat/completions`,
	};
};

const createChatCompletion = async (
	apiKey: string,
	json: CreateChatCompletionRequest,
	timeout: number,
	proxy?: string,
	baseUrl?: string,
	onStreamEvent?: CompletionStreamCallback,
) => {
	const requestBody = {
		...json,
		stream: true,
	} as CreateChatCompletionRequest;

	let liveStreamBuffer = '';
	const emitStreamEventFromPayload = (payload: Record<string, unknown>) => {
		if (!onStreamEvent) {
			return;
		}

		const choices = Array.isArray(payload.choices) ? payload.choices : [];
		for (const choice of choices) {
			if (typeof choice !== 'object' || choice === null) {
				continue;
			}

			const { delta } = choice as Record<string, unknown>;
			if (typeof delta !== 'object' || delta === null) {
				continue;
			}

			const deltaRecord = delta as Record<string, unknown>;
			const reasoningContent = (
				typeof deltaRecord.reasoning_content === 'string'
					? deltaRecord.reasoning_content
					: (
						typeof deltaRecord.reasoning === 'string'
							? deltaRecord.reasoning
							: ''
					)
			);
			if (reasoningContent) {
				onStreamEvent({
					kind: 'reasoning',
					text: reasoningContent,
				});
			}

			if (typeof deltaRecord.content === 'string' && deltaRecord.content.length > 0) {
				onStreamEvent({
					kind: 'content',
					text: deltaRecord.content,
				});
			}
		}
	};

	const handleLiveChunk = (chunk: string) => {
		if (!onStreamEvent) {
			return;
		}

		liveStreamBuffer += chunk.replace(/\r\n/g, '\n');
		let separatorIndex = liveStreamBuffer.indexOf('\n\n');
		while (separatorIndex !== -1) {
			const rawEvent = liveStreamBuffer.slice(0, separatorIndex);
			liveStreamBuffer = liveStreamBuffer.slice(separatorIndex + 2);

			for (const rawLine of rawEvent.split('\n')) {
				const line = rawLine.trim();
				if (!line.startsWith('data:')) {
					continue;
				}

				const payload = line.slice(5).trim();
				if (!payload || payload === '[DONE]') {
					continue;
				}

				try {
					const parsedPayload = JSON.parse(payload) as Record<string, unknown>;
					emitStreamEventFromPayload(parsedPayload);
				} catch {}
			}

			separatorIndex = liveStreamBuffer.indexOf('\n\n');
		}
	};

	const endpoint = resolveChatCompletionsEndpoint(baseUrl);
	const { response, data } = await httpsPost(
		endpoint.hostname,
		endpoint.path,
		{
			Authorization: `Bearer ${apiKey}`,
		},
		requestBody,
		timeout,
		proxy,
		endpoint.port,
		handleLiveChunk,
	);

	if (
		!response.statusCode
		|| response.statusCode < 200
		|| response.statusCode > 299
	) {
		let errorMessage = `API Error: ${response.statusCode} - ${response.statusMessage}`;

		if (data) {
			errorMessage += `\n\n${data}`;
		}

		throw new KnownError(errorMessage);
	}

	const trimmed = data.trim();
	if (!trimmed) {
		throw new KnownError('API Error: Empty response body');
	}

	if (trimmed.startsWith('{')) {
		return JSON.parse(trimmed) as CreateChatCompletionResponse;
	}

	const streamPayloads: Array<Record<string, unknown>> = [];
	for (const rawLine of trimmed.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line.startsWith('data:')) {
			continue;
		}

		const payload = line.slice(5).trim();
		if (!payload || payload === '[DONE]') {
			continue;
		}

		try {
			streamPayloads.push(JSON.parse(payload) as Record<string, unknown>);
		} catch {}
	}

	if (streamPayloads.length === 0) {
		throw new KnownError('API Error: Unable to parse streamed response');
	}

	const streamError = streamPayloads.find(payload => (
		typeof payload.error === 'object'
		&& payload.error !== null
	));
	if (streamError?.error && typeof streamError.error === 'object' && streamError.error !== null) {
		const message = 'message' in streamError.error && typeof streamError.error.message === 'string'
			? streamError.error.message
			: JSON.stringify(streamError.error);
		throw new KnownError(`API Error: ${message}`);
	}

	const firstPayload = streamPayloads.find(payload => typeof payload.id === 'string') || streamPayloads[0];

	type StreamChoice = {
		index: number;
		role?: string;
		finishReason?: string | null;
		contentParts: string[];
		reasoningParts: string[];
	};

	const streamChoices = new Map<number, StreamChoice>();
	for (const payload of streamPayloads) {
		const choices = Array.isArray(payload.choices) ? payload.choices : [];
		for (const choice of choices) {
			if (typeof choice !== 'object' || choice === null) {
				continue;
			}

			const choiceRecord = choice as Record<string, unknown>;
			const index = typeof choiceRecord.index === 'number' ? choiceRecord.index : 0;
			const existing = streamChoices.get(index) || {
				index,
				contentParts: [],
				reasoningParts: [],
			};

			const { delta } = choiceRecord;
			if (typeof delta === 'object' && delta !== null) {
				const deltaRecord = delta as Record<string, unknown>;
				if (typeof deltaRecord.role === 'string') {
					existing.role = deltaRecord.role;
				}

				if (typeof deltaRecord.content === 'string') {
					existing.contentParts.push(deltaRecord.content);
				}

				if (typeof deltaRecord.reasoning_content === 'string') {
					existing.reasoningParts.push(deltaRecord.reasoning_content);
				}

				if (typeof deltaRecord.reasoning === 'string') {
					existing.reasoningParts.push(deltaRecord.reasoning);
				}
			}

			const finishReason = choiceRecord.finish_reason;
			if (typeof finishReason === 'string' || finishReason === null) {
				existing.finishReason = finishReason;
			}

			streamChoices.set(index, existing);
		}
	}

	const combinedChoices = Array.from(streamChoices.values())
		.sort((a, b) => a.index - b.index)
		.map((choice) => {
			const message: Record<string, unknown> = {
				role: choice.role || 'assistant',
				content: choice.contentParts.join(''),
			};

			const reasoningContent = choice.reasoningParts.join('');
			if (reasoningContent) {
				message.reasoning_content = reasoningContent;
			}

			return {
				index: choice.index,
				finish_reason: choice.finishReason ?? 'stop',
				message: message as any,
			};
		});

	if (combinedChoices.length === 0) {
		throw new KnownError('API Error: Streamed response did not include any choices');
	}

	return {
		id: typeof firstPayload.id === 'string' ? firstPayload.id : '',
		object: 'chat.completion',
		created: typeof firstPayload.created === 'number'
			? firstPayload.created
			: Math.floor(Date.now() / 1000),
		model: typeof firstPayload.model === 'string' ? firstPayload.model : '',
		choices: combinedChoices as unknown as CreateChatCompletionResponse['choices'],
		usage: undefined as any,
	} as CreateChatCompletionResponse;
};

const createMinimalChatRequest = (
	model: TiktokenModel,
	messages: CreateChatCompletionRequest['messages'],
): CreateChatCompletionRequest => {
	const request: CreateChatCompletionRequest = {
		model,
		messages,
	};

	return request;
};

const normalizeLineEndings = (text: string) => text.replace(/\r\n?/g, '\n');

const stripCodeFences = (text: string) => {
	const fencedContent = text.match(/```[\w-]*\n([\s\S]*?)```/);

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
	.replace(/^\s*(主要改动包括|主要改动|改动包括)\s*[:：]\s*/, '')
	.replace(/^\s*(impact|影响)\s*[:：]\s*/i, '');

const splitListFragments = (line: string) => line
	.split(/(?<=[。！？.!?])\s+/u)
	.map(fragment => fragment.trim())
	.filter(Boolean);

const listMarkerPattern = /^(?:[-*•]+|\d+[.)])\s*/u;
const noiseOnlyPattern = /^[\s\-–—_*•.,;:!?()[\]{}"'`]+$/u;

const normalizeListItem = (item: string) => {
	let normalized = item.trim();
	if (!normalized) {
		return '';
	}

	// Remove nested markers like "- - actual text" or "1. - text".
	while (listMarkerPattern.test(normalized)) {
		const next = normalized.replace(listMarkerPattern, '').trim();
		if (!next || next === normalized) {
			break;
		}
		normalized = next;
	}

	if (!normalized || noiseOnlyPattern.test(normalized)) {
		return '';
	}

	return normalized;
};

const parseLeadingBullet = (line: string) => {
	const trimmed = line.trim();
	if (!trimmed) {
		return undefined;
	}

	if (
		trimmed.startsWith('- ')
		|| trimmed.startsWith('* ')
		|| trimmed.startsWith('• ')
	) {
		return trimmed.slice(2).trim() || undefined;
	}

	const numberedPrefixMatch = /^\d+[.)]\s+/.exec(trimmed);
	if (!numberedPrefixMatch?.[0]) {
		return undefined;
	}

	return trimmed.slice(numberedPrefixMatch[0].length).trim() || undefined;
};

const normalizeDetailedBody = (body: string) => {
	if (!body.trim()) {
		return {
			paragraph: '',
			listItems: [] as string[],
		};
	}

	const lines = body
		.split('\n')
		.map(line => stripBodyLabels(line.trim()))
		.filter(Boolean);

	if (lines.length === 0) {
		return {
			paragraph: '',
			listItems: [] as string[],
		};
	}

	const listItems: string[] = [];
	const proseLines: string[] = [];

	for (const line of lines) {
		const bullet = parseLeadingBullet(line);
		if (bullet) {
			listItems.push(bullet);
		} else {
			proseLines.push(line.trim());
			listItems.push(...splitListFragments(line));
		}
	}

	const paragraph = [
		...proseLines,
		...listItems,
	]
		.join(' ')
		.replace(/\s{2,}/g, ' ')
		.replace(/\s+([,.;:!?])/g, '$1')
		.trim();

	const dedupedListItems = Array.from(new Set(
		listItems
			.map(normalizeListItem)
			.filter(Boolean),
	));

	return {
		paragraph,
		listItems: dedupedListItems,
	};
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

const sanitizeDetailedMessage = (
	message: string,
	detailsStyle: DetailsStyle,
) => {
	const cleaned = stripCodeFences(message);
	const { title, body } = splitCommitMessage(cleaned);
	const normalizedBody = normalizeDetailedBody(body);

	if (detailsStyle === 'list') {
		const bodyAsList = normalizedBody.listItems
			.slice(0, 6)
			.map(item => `- ${item}`)
			.join('\n');

		return formatCommitMessage(title, bodyAsList);
	}

	return formatCommitMessage(title, normalizedBody.paragraph);
};

const sanitizeMessage = (
	message: string,
	includeDetails: boolean,
	detailsStyle: DetailsStyle,
) => {
	if (includeDetails) {
		return sanitizeDetailedMessage(message, detailsStyle);
	}

	return sanitizeSimpleMessage(message);
};

export type CommitMessageStreamPhase = 'message' | 'title-rewrite';
export type CommitMessageStreamEvent = CompletionStreamEvent & {
	phase: CommitMessageStreamPhase;
};
export type GenerateCommitMessageOptions = PromptOptions & {
	onStreamEvent?: (event: CommitMessageStreamEvent) => void;
};

const normalizeKey = (value: string) => value.trim().toLowerCase();

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));
const chineseCharacterPattern = /[\u3400-\u9FFF]/;
const conventionalTitlePrefixPattern = /^([a-z]+(?:\([^)]+\))?: )(.+)$/i;
const conventionalTitleTypeScopePattern = /^([a-z]+)(\([^)]+\))?: (.+)$/i;
const conventionalLeadingTypePattern = /^([a-z]+)(?:\s+|[:-])/i;
const conventionalTypeAliasMap: Record<string, string> = {
	feature: 'feat',
	features: 'feat',
	bug: 'fix',
	bugfix: 'fix',
	performance: 'perf',
};

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

const createConventionalTypeLookup = (rawConventionalTypes?: string) => {
	const lookup = new Map<string, string>();
	const parsed = parseConventionalTypes(rawConventionalTypes);

	for (const typeName of Object.keys(parsed)) {
		lookup.set(normalizeKey(typeName), typeName);
	}

	for (const [alias, canonical] of Object.entries(conventionalTypeAliasMap)) {
		if (lookup.has(normalizeKey(alias))) {
			continue;
		}

		const mapped = lookup.get(normalizeKey(canonical));
		if (mapped) {
			lookup.set(normalizeKey(alias), mapped);
		}
	}

	return lookup;
};

const resolveConventionalTypeToken = (
	token: string,
	lookup: Map<string, string>,
) => lookup.get(normalizeKey(token));

const inferConventionalTypeFromSubject = (
	subject: string,
	lookup: Map<string, string>,
) => {
	const match = subject.trim().match(conventionalLeadingTypePattern);
	if (!match?.[1]) {
		return undefined;
	}

	return resolveConventionalTypeToken(match[1], lookup);
};

const stripLeadingTypeWord = (
	subject: string,
	typeName: string,
	lookup: Map<string, string>,
) => {
	const trimmedSubject = subject.trim();
	const leadingTypeMatch = trimmedSubject.match(/^([a-z]+)(?:\s+|[:-])/i);
	if (!leadingTypeMatch?.[1]) {
		return subject;
	}

	const stripped = trimmedSubject.slice(leadingTypeMatch[0].length).trim();
	if (!stripped) {
		return subject;
	}

	const resolvedLeadingType = resolveConventionalTypeToken(leadingTypeMatch[1], lookup);
	if (!resolvedLeadingType) {
		return subject;
	}

	if (normalizeKey(resolvedLeadingType) !== normalizeKey(typeName)) {
		return subject;
	}

	return stripped || subject;
};

const harmonizeConventionalTitle = (
	title: string,
	lookup: Map<string, string>,
) => {
	const match = title.match(conventionalTitleTypeScopePattern);
	if (!match) {
		return title;
	}

	const [, rawType, rawScope = '', rawSubject = ''] = match;
	const subject = rawSubject.trim();
	if (!subject) {
		return title;
	}

	const currentType = resolveConventionalTypeToken(rawType, lookup) || rawType.toLowerCase();
	const inferredType = inferConventionalTypeFromSubject(subject, lookup);
	const nextType = inferredType || currentType;
	const nextSubject = stripLeadingTypeWord(subject, nextType, lookup);

	return `${nextType}${rawScope}: ${nextSubject || subject}`;
};

const harmonizeConventionalMessage = (
	message: string,
	includeDetails: boolean,
	lookup: Map<string, string>,
) => {
	const { title, body } = includeDetails
		? splitCommitMessage(message)
		: { title: message.trim(), body: '' };
	const harmonizedTitle = harmonizeConventionalTitle(title, lookup);

	return includeDetails
		? formatCommitMessage(harmonizedTitle, body)
		: harmonizedTitle;
};

export const stripConventionalScopeFromMessage = (
	message: string,
	includeDetails: boolean,
) => {
	const { title, body } = includeDetails
		? splitCommitMessage(message)
		: { title: message.trim(), body: '' };

	const match = title.match(conventionalTitleTypeScopePattern);
	if (!match) {
		return message;
	}

	const [, rawType = '', , rawSubject = ''] = match;
	const normalizedType = rawType.trim().toLowerCase();
	const normalizedSubject = rawSubject.trim();
	if (!normalizedType || !normalizedSubject) {
		return message;
	}

	const normalizedTitle = `${normalizedType}: ${normalizedSubject}`;
	return includeDetails
		? formatCommitMessage(normalizedTitle, body)
		: normalizedTitle;
};

const conventionalScopedTitlePattern = /^[a-z]+\([^)\s][^)]*\):\s*\S/i;

const getMessageTitle = (
	message: string,
	includeDetails: boolean,
) => (
	includeDetails
		? splitCommitMessage(message).title
		: message.trim()
);

const supportsConventionalScope = (
	conventionalFormat: string | undefined,
) => {
	if (!conventionalFormat?.trim()) {
		return true;
	}

	return /<\s*scope\s*>/i.test(conventionalFormat);
};

const hasConventionalScope = (
	message: string,
	includeDetails: boolean,
) => conventionalScopedTitlePattern.test(getMessageTitle(message, includeDetails));

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
	baseUrl?: string,
	onStreamEvent?: CompletionStreamCallback,
) => {
	const { prefix, subject } = splitConventionalTitle(title);

	const request: CreateChatCompletionRequest = createMinimalChatRequest(
		model,
		[
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
	);

	const completion = await createChatCompletion(
		apiKey,
		request,
		timeout,
		proxy,
		baseUrl,
		onStreamEvent,
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
	baseUrl?: string,
	onStreamEvent?: CompletionStreamCallback,
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
			baseUrl,
			onStreamEvent,
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
	options?: GenerateCommitMessageOptions,
	baseUrl?: string,
) => {
	const resolvedOptions = options ?? {};
	const includeDetails = resolvedOptions.includeDetails ?? false;
	const detailsStyle: DetailsStyle = resolvedOptions.detailsStyle ?? 'paragraph';
	const conventionalTypeLookup = createConventionalTypeLookup(resolvedOptions.conventionalTypes);
	const enforceConventionalScope = (
		type === 'conventional'
		&& (resolvedOptions.conventionalScope ?? false)
		&& supportsConventionalScope(resolvedOptions.conventionalFormat)
	);

	const requestMessages = async (
		extraInstructions?: string,
		includeUserInstructions = true,
	) => {
		const mergedInstructions = [
			includeUserInstructions ? resolvedOptions.instructions?.trim() : '',
			extraInstructions?.trim(),
		]
			.filter(Boolean)
			.join('\n');

		const promptOptions: PromptOptions = {
			includeDetails: resolvedOptions.includeDetails,
			detailsStyle: resolvedOptions.detailsStyle,
			instructions: mergedInstructions,
			conventionalFormat: resolvedOptions.conventionalFormat,
			conventionalTypes: resolvedOptions.conventionalTypes,
			conventionalScope: resolvedOptions.conventionalScope,
			changedFiles: resolvedOptions.changedFiles,
		};

		const requestPayloadMessages = [
			{
				role: 'system' as const,
				content: generatePrompt(locale, maxLength, type, promptOptions),
			},
			{
				role: 'user' as const,
				content: diff,
			},
		];

		const requestCount = Math.max(1, completions);
		const completionResponses = await Promise.all(
			Array.from({ length: requestCount }, () => createChatCompletion(
				apiKey,
				createMinimalChatRequest(
					model,
					requestPayloadMessages,
				),
				timeout,
				proxy,
				baseUrl,
				event => resolvedOptions.onStreamEvent?.({
					phase: 'message',
					...event,
				}),
			)),
		);

		const messages = completionResponses
			.flatMap(completion => completion.choices)
			.flatMap((choice) => {
				const content = choice.message?.content;
				if (typeof content !== 'string') {
					return [];
				}

				return [sanitizeMessage(content, includeDetails, detailsStyle)];
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
				baseUrl,
				event => resolvedOptions.onStreamEvent?.({
					phase: 'title-rewrite',
					...event,
				}),
			)),
		);

		const harmonizedMessages = type === 'conventional'
			? localizedMessages.map(message => harmonizeConventionalMessage(
				message,
				includeDetails,
				conventionalTypeLookup,
			))
			: localizedMessages;
		const scopeNormalizedMessages = (
			type === 'conventional'
				&& resolvedOptions.conventionalScope === false
		)
			? harmonizedMessages.map(message => stripConventionalScopeFromMessage(
				message,
				includeDetails,
			))
			: harmonizedMessages;

		return deduplicateMessages(
			scopeNormalizedMessages
				.filter(Boolean),
		);
	};

	try {
		const firstPassMessages = await requestMessages();
		if (!enforceConventionalScope) {
			return firstPassMessages;
		}

		const firstPassScopedMessages = firstPassMessages
			.filter(message => hasConventionalScope(message, includeDetails));
		if (firstPassScopedMessages.length > 0) {
			return firstPassScopedMessages;
		}

		const secondPassMessages = await requestMessages(
			[
				'Hard requirement for this run: use conventional title with non-empty scope exactly in "<type>(<scope>): <subject>" format.',
				'Do not omit scope. Pick the strongest file/class/module anchor as scope.',
			].join('\n'),
			false,
		);
		const secondPassScopedMessages = secondPassMessages
			.filter(message => hasConventionalScope(message, includeDetails));

		if (secondPassScopedMessages.length > 0) {
			return secondPassScopedMessages;
		}

		return secondPassMessages;
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`);
		}

		throw errorAsAny;
	}
};
