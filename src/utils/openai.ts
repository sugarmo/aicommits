import https, { type RequestOptions } from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import type { CreateChatCompletionRequest } from 'openai';
import {
	type TiktokenModel,
} from '@dqbd/tiktoken';
import createHttpsProxyAgent from 'https-proxy-agent';
import { KnownError } from './error.js';
import type {
	ApiMode,
	ConfiguredReasoningEffort,
} from './config.js';
import {
	generatePrompt,
	type PromptOptions,
} from './prompt.js';

type DetailsStyle = 'paragraph' | 'list' | 'markdown';

type CompletionStreamEvent = {
	kind: 'reasoning' | 'content';
	text: string;
};

type CompletionStreamCallback = (event: CompletionStreamEvent) => void;

type GeneratedMessage = {
	role: string;
	content: string;
	reasoning_content?: string;
};

type GeneratedChoice = {
	index: number;
	finish_reason?: string | null;
	message: GeneratedMessage;
};

type GeneratedResponse = {
	model: string;
	choices: GeneratedChoice[];
};

type ReasoningTagParseState = {
	carry: string;
	inReasoningBlock: boolean;
};

const thinkTagOpen = '<think>';
const thinkTagClose = '</think>';

const createReasoningTagParseState = (): ReasoningTagParseState => ({
	carry: '',
	inReasoningBlock: false,
});

const getTrailingTagFragmentLength = (
	text: string,
	tag: string,
) => {
	const maxLength = Math.min(text.length, tag.length - 1);
	for (let length = maxLength; length > 0; length -= 1) {
		if (tag.startsWith(text.slice(-length))) {
			return length;
		}
	}

	return 0;
};

const splitReasoningTaggedChunk = (
	chunk: string,
	state: ReasoningTagParseState,
) => {
	let remainder = `${state.carry}${chunk}`;
	const nextState: ReasoningTagParseState = {
		carry: '',
		inReasoningBlock: state.inReasoningBlock,
	};
	let content = '';
	let reasoning = '';

	while (remainder.length > 0) {
		const activeTag = nextState.inReasoningBlock ? thinkTagClose : thinkTagOpen;
		const tagIndex = remainder.indexOf(activeTag);

		if (tagIndex === -1) {
			const trailingFragmentLength = getTrailingTagFragmentLength(remainder, activeTag);
			const safeText = remainder.slice(0, remainder.length - trailingFragmentLength);

			if (nextState.inReasoningBlock) {
				reasoning += safeText;
			} else {
				content += safeText;
			}

			nextState.carry = remainder.slice(remainder.length - trailingFragmentLength);
			break;
		}

		const segment = remainder.slice(0, tagIndex);
		if (nextState.inReasoningBlock) {
			reasoning += segment;
		} else {
			content += segment;
		}

		nextState.inReasoningBlock = !nextState.inReasoningBlock;
		remainder = remainder.slice(tagIndex + activeTag.length);
	}

	return {
		content,
		reasoning,
		state: nextState,
	};
};

const flushReasoningTaggedState = (state: ReasoningTagParseState) => ({
	content: state.inReasoningBlock ? '' : state.carry,
	reasoning: state.inReasoningBlock ? state.carry : '',
	state: createReasoningTagParseState(),
});

export const separateReasoningBlocks = (parts: string[]) => {
	let state = createReasoningTagParseState();
	let content = '';
	let reasoning = '';

	for (const part of parts) {
		const separated = splitReasoningTaggedChunk(part, state);
		content += separated.content;
		reasoning += separated.reasoning;
		state = separated.state;
	}

	const flushed = flushReasoningTaggedState(state);
	content += flushed.content;
	reasoning += flushed.reasoning;

	return {
		content,
		reasoning,
	};
};

export const stripReasoningBlocksFromContent = (content: string) => (
	separateReasoningBlocks([content]).content
);

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

const resolveApiEndpoint = (
	baseUrl: string | undefined,
	pathnameSuffix: string,
) => {
	if (!baseUrl?.trim()) {
		throw new KnownError('Please set your API base URL via `aicommits config set base-url=<https://...>`');
	}

	const normalized = baseUrl.trim();
	const parsed = new URL(normalized);
	const normalizedPath = parsed.pathname.replace(/\/+$/, '');

	return {
		hostname: parsed.hostname,
		port: parsed.port ? Number(parsed.port) : 443,
		path: `${normalizedPath}${pathnameSuffix}`,
	};
};

const resolveChatCompletionsEndpoint = (baseUrl?: string) => resolveApiEndpoint(
	baseUrl,
	'/chat/completions',
);

const resolveResponsesEndpoint = (baseUrl?: string) => resolveApiEndpoint(
	baseUrl,
	'/responses',
);

const createChatCompletion = async (
	apiKey: string,
	json: CreateChatCompletionRequest,
	timeout: number,
	proxy?: string,
	baseUrl?: string,
	onStreamEvent?: CompletionStreamCallback,
	requestOptions?: Record<string, unknown>,
): Promise<GeneratedResponse> => {
	const requestBody = {
		...json,
		...requestOptions,
		stream: true,
	} as CreateChatCompletionRequest;

	let liveStreamBuffer = '';
	const liveReasoningStates = new Map<number, ReasoningTagParseState>();
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
				const index = typeof (choice as Record<string, unknown>).index === 'number'
					? (choice as Record<string, unknown>).index as number
					: 0;

				if (reasoningContent) {
					onStreamEvent({
						kind: 'content',
						text: deltaRecord.content,
					});
					continue;
				}

				const liveState = liveReasoningStates.get(index) || createReasoningTagParseState();
				const separated = splitReasoningTaggedChunk(deltaRecord.content, liveState);
				liveReasoningStates.set(index, separated.state);

				if (separated.reasoning) {
					onStreamEvent({
						kind: 'reasoning',
						text: separated.reasoning,
					});
				}

				if (separated.content) {
					onStreamEvent({
						kind: 'content',
						text: separated.content,
					});
				}
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
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
		return {
			model: typeof parsed.model === 'string' ? parsed.model : '',
			choices: choices.map((choice, index) => {
				const record = (typeof choice === 'object' && choice !== null)
					? choice as Record<string, unknown>
					: {};
				const message = (
					typeof record.message === 'object' && record.message !== null
						? record.message as Record<string, unknown>
						: {}
				);
				return {
					index: typeof record.index === 'number' ? record.index : index,
					finish_reason: typeof record.finish_reason === 'string' || record.finish_reason === null
						? record.finish_reason as string | null
						: undefined,
					message: {
						role: typeof message.role === 'string' ? message.role : 'assistant',
						content: typeof message.content === 'string' ? message.content : '',
						...(typeof message.reasoning_content === 'string'
							? { reasoning_content: message.reasoning_content }
							: {}),
					},
				};
			}),
		};
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

	const firstPayload = streamPayloads.find(payload => typeof payload.model === 'string') || streamPayloads[0];

	type StreamChoice = {
		index: number;
		role?: string;
		finishReason?: string | null;
		contentParts: string[];
		reasoningParts: string[];
	};

	const streamChoices = new Map<number, StreamChoice>();
	const reasoningTagStates = new Map<number, ReasoningTagParseState>();
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
					const hasExplicitReasoning = (
						typeof deltaRecord.reasoning_content === 'string'
						|| typeof deltaRecord.reasoning === 'string'
					);

					if (hasExplicitReasoning) {
						existing.contentParts.push(deltaRecord.content);
					} else {
						const parseState = reasoningTagStates.get(index) || createReasoningTagParseState();
						const separated = splitReasoningTaggedChunk(deltaRecord.content, parseState);
						reasoningTagStates.set(index, separated.state);

						if (separated.content) {
							existing.contentParts.push(separated.content);
						}

						if (separated.reasoning) {
							existing.reasoningParts.push(separated.reasoning);
						}
					}
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

	for (const [index, state] of reasoningTagStates.entries()) {
		const existing = streamChoices.get(index);
		if (!existing) {
			continue;
		}

		const flushed = flushReasoningTaggedState(state);
		if (flushed.content) {
			existing.contentParts.push(flushed.content);
		}
		if (flushed.reasoning) {
			existing.reasoningParts.push(flushed.reasoning);
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
		model: typeof firstPayload.model === 'string' ? firstPayload.model : '',
		choices: combinedChoices,
	};
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

const resolveRewriteFeedbackHistory = (
	options: Pick<PromptOptions, 'rewriteFeedback' | 'rewriteFeedbackHistory'>,
) => {
	const history = (options.rewriteFeedbackHistory ?? [])
		.map(feedback => feedback.trim())
		.filter(Boolean);

	if (history.length > 0) {
		return history;
	}

	const latestFeedback = options.rewriteFeedback?.trim();
	return latestFeedback ? [latestFeedback] : [];
};

const resolveRewriteConversation = (
	options: Pick<
		PromptOptions,
		'rewriteConversation' | 'rewriteFromMessage' | 'rewriteFeedback' | 'rewriteFeedbackHistory'
	>,
) => {
	const normalizedConversation = (options.rewriteConversation ?? [])
		.flatMap((turn) => {
			if (!turn || (turn.role !== 'assistant' && turn.role !== 'user')) {
				return [];
			}

			const content = turn.content.trim();
			return content
				? [{
					role: turn.role,
					content,
				}]
				: [];
		});

	if (normalizedConversation.length > 0) {
		return normalizedConversation;
	}

	const rewriteFromMessage = options.rewriteFromMessage?.trim();
	const feedbackHistory = resolveRewriteFeedbackHistory(options);
	if (!rewriteFromMessage || feedbackHistory.length === 0) {
		return [];
	}

	return [
		{
			role: 'assistant' as const,
			content: rewriteFromMessage,
		},
		{
			role: 'user' as const,
			content: buildRewriteFeedbackMessage(feedbackHistory),
		},
	];
};

const buildRewriteFeedbackMessage = (
	feedbackHistory: string[],
) => [
	'Revise your previous commit message instead of drafting a new one from scratch.',
	'Keep the parts of your previous message that still fit the diff unless the feedback requires changing them.',
	'Apply all of the following rewrite feedback, not just the latest item:',
	...feedbackHistory.map((feedback, index) => `${index + 1}. ${feedback}`),
	'Return only the revised final commit message text.',
].join('\n\n');

export const buildCommitMessageChatMessages = (
	instructions: string,
	diff: string,
	options: Pick<PromptOptions, 'rewriteConversation' | 'rewriteFromMessage' | 'rewriteFeedback' | 'rewriteFeedbackHistory'>,
): CreateChatCompletionRequest['messages'] => {
	const rewriteConversation = resolveRewriteConversation(options);

	if (rewriteConversation.length === 0) {
		return [
			{
				role: 'system' as const,
				content: instructions,
			},
			{
				role: 'user' as const,
				content: diff,
			},
		];
	}

	return [
		{
			role: 'system' as const,
			content: instructions,
		},
		{
			role: 'user' as const,
			content: diff,
		},
		...rewriteConversation,
	];
};

type ResponsesOutputTextPart = {
	type?: string;
	text?: string;
};

type ResponsesReasoningPart = {
	type?: string;
	text?: string;
};

type ResponsesOutputItem = {
	type?: string;
	role?: string;
	content?: ResponsesOutputTextPart[];
	summary?: ResponsesReasoningPart[];
};

type ResponsesApiResponse = {
	model?: string;
	output?: ResponsesOutputItem[];
};

type ResponsesRequestInput = string | Array<{
	role: 'user' | 'assistant';
	content: string;
}>;

const createMinimalResponsesRequest = (
	model: TiktokenModel,
	instructions: string,
	input: ResponsesRequestInput,
) => ({
	model,
	instructions,
	input,
});

export const buildCommitMessageResponsesInput = (
	diff: string,
	options: Pick<PromptOptions, 'rewriteConversation' | 'rewriteFromMessage' | 'rewriteFeedback' | 'rewriteFeedbackHistory'>,
): ResponsesRequestInput => {
	const rewriteConversation = resolveRewriteConversation(options);

	if (rewriteConversation.length === 0) {
		return diff;
	}

	return [
		{
			role: 'user',
			content: diff,
		},
		...rewriteConversation,
	];
};

const collectResponsesText = (parts: unknown) => {
	if (!Array.isArray(parts)) {
		return '';
	}

	return parts
		.flatMap((part) => {
			if (typeof part !== 'object' || part === null) {
				return [];
			}

			const text = 'text' in part && typeof part.text === 'string'
				? part.text
				: '';

			return text ? [text] : [];
		})
		.join('');
};

const convertResponsesOutputToGeneratedResponse = (
	response: ResponsesApiResponse,
): GeneratedResponse => {
	const outputItems = Array.isArray(response.output) ? response.output : [];
	const content = outputItems
		.filter(item => item?.type === 'message' || item?.role === 'assistant')
		.map(item => collectResponsesText(item.content))
		.join('');
	const reasoning = outputItems
		.filter(item => item?.type === 'reasoning')
		.map(item => collectResponsesText(item.summary))
		.join('');

	return {
		model: typeof response.model === 'string' ? response.model : '',
		choices: [
			{
				index: 0,
				finish_reason: 'stop',
				message: {
					role: 'assistant',
					content,
					...(reasoning ? { reasoning_content: reasoning } : {}),
				},
			},
		],
	};
};

const createResponsesResponseFromStream = (
	streamPayloads: Array<Record<string, unknown>>,
) => {
	const completedPayload = streamPayloads.find(payload => payload.type === 'response.completed');
	if (
		completedPayload
		&& typeof completedPayload.response === 'object'
		&& completedPayload.response !== null
	) {
		return convertResponsesOutputToGeneratedResponse(
			completedPayload.response as ResponsesApiResponse,
		);
	}

	const outputText = streamPayloads
		.filter(payload => (
			typeof payload.type === 'string'
			&& payload.type.includes('output_text')
			&& payload.type.endsWith('.delta')
			&& typeof payload.delta === 'string'
		))
		.map(payload => payload.delta as string)
		.join('');
	const reasoningText = streamPayloads
		.filter(payload => (
			typeof payload.type === 'string'
			&& payload.type.includes('reasoning')
			&& payload.type.endsWith('.delta')
			&& typeof payload.delta === 'string'
		))
		.map(payload => payload.delta as string)
		.join('');

	return {
		model: '',
		choices: [
			{
				index: 0,
				finish_reason: 'stop',
				message: {
					role: 'assistant',
					content: outputText,
					...(reasoningText ? { reasoning_content: reasoningText } : {}),
				},
			},
		],
	} satisfies GeneratedResponse;
};

const createResponsesResponse = async (
	apiKey: string,
	json: Record<string, unknown>,
	timeout: number,
	proxy?: string,
	baseUrl?: string,
	onStreamEvent?: CompletionStreamCallback,
	requestOptions?: Record<string, unknown>,
): Promise<GeneratedResponse> => {
	const requestBody = {
		...json,
		...requestOptions,
		stream: true,
	};

	let liveStreamBuffer = '';
	const emitStreamEventFromPayload = (payload: Record<string, unknown>) => {
		if (!onStreamEvent || typeof payload.type !== 'string') {
			return;
		}

		if (
			payload.type.includes('reasoning')
			&& payload.type.endsWith('.delta')
			&& typeof payload.delta === 'string'
		) {
			onStreamEvent({
				kind: 'reasoning',
				text: payload.delta,
			});
			return;
		}

		if (
			payload.type.includes('output_text')
			&& payload.type.endsWith('.delta')
			&& typeof payload.delta === 'string'
		) {
			onStreamEvent({
				kind: 'content',
				text: payload.delta,
			});
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
					emitStreamEventFromPayload(JSON.parse(payload) as Record<string, unknown>);
				} catch {}
			}

			separatorIndex = liveStreamBuffer.indexOf('\n\n');
		}
	};

	const endpoint = resolveResponsesEndpoint(baseUrl);
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
		return convertResponsesOutputToGeneratedResponse(
			JSON.parse(trimmed) as ResponsesApiResponse,
		);
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
		payload.type === 'error'
		|| (
			typeof payload.error === 'object'
			&& payload.error !== null
		)
	));
	if (streamError) {
		if (typeof streamError.error === 'object' && streamError.error !== null) {
			const message = 'message' in streamError.error && typeof streamError.error.message === 'string'
				? streamError.error.message
				: JSON.stringify(streamError.error);
			throw new KnownError(`API Error: ${message}`);
		}

		if (typeof streamError.message === 'string') {
			throw new KnownError(`API Error: ${streamError.message}`);
		}
	}

	return createResponsesResponseFromStream(streamPayloads);
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

const hasExplicitMarkdownLineSyntax = (body: string) => body
	.split('\n')
	.some((line) => {
		const trimmed = line.trim();
		if (!trimmed) {
			return false;
		}

		return (
			trimmed.startsWith('- ')
			|| trimmed.startsWith('* ')
			|| trimmed.startsWith('+ ')
			|| trimmed.startsWith('> ')
			|| /^#{1,6}\s/u.test(trimmed)
			|| /^\d+[.)]\s+/u.test(trimmed)
		);
	});

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

const defaultDetailColumnGuide = 72;
const minimumDetailColumnGuide = 20;
const listItemPrefix = '- ';
const listItemContinuationPrefix = '  ';

const getCodePointLength = (value: string) => Array.from(value).length;

const resolveDetailColumnGuide = (detailColumnGuide: number) => (
	Number.isInteger(detailColumnGuide) && detailColumnGuide >= minimumDetailColumnGuide
		? detailColumnGuide
		: defaultDetailColumnGuide
);

const wrapTextByColumns = (
	text: string,
	firstLineColumn: number,
	nextLineColumn = firstLineColumn,
) => {
	const normalized = text.trim();
	if (!normalized) {
		return [] as string[];
	}

	const firstColumn = Math.max(1, firstLineColumn);
	const nextColumn = Math.max(1, nextLineColumn);
	const tokens = normalized.split(/\s+/u).filter(Boolean);
	const lines: string[] = [];
	let currentLine = '';
	let currentColumn = firstColumn;
	let firstLineUsed = false;

	const pushLine = (line: string) => {
		lines.push(line);
		if (!firstLineUsed) {
			firstLineUsed = true;
			currentColumn = nextColumn;
		}
	};

	for (const token of tokens) {
		if (!currentLine) {
			currentLine = token;
			continue;
		}

		const nextLine = `${currentLine} ${token}`;
		if (getCodePointLength(nextLine) <= currentColumn) {
			currentLine = nextLine;
			continue;
		}

		pushLine(currentLine);
		currentLine = token;
	}

	if (currentLine) {
		pushLine(currentLine);
	}

	return lines;
};

const formatListItemWithColumnGuide = (
	item: string,
	detailColumnGuide: number,
) => {
	const trimmed = item.trim();
	if (!trimmed) {
		return listItemPrefix.trimEnd();
	}

	const firstContentColumn = Math.max(
		1,
		detailColumnGuide - getCodePointLength(listItemPrefix),
	);
	const continuationContentColumn = Math.max(
		1,
		detailColumnGuide - getCodePointLength(listItemContinuationPrefix),
	);
	const wrapped = wrapTextByColumns(
		trimmed,
		firstContentColumn,
		continuationContentColumn,
	);

	if (wrapped.length === 0) {
		return listItemPrefix.trimEnd();
	}

	return wrapped
		.map((line, index) => `${index === 0 ? listItemPrefix : listItemContinuationPrefix}${line}`)
		.join('\n');
};

export const formatMarkdownBodyWithColumnGuide = (
	body: string,
	_detailColumnGuide: number,
) => {
	const lines = normalizeLineEndings(body)
		.split('\n')
		.map(line => line.replace(/\s+$/g, ''));

	while (lines[0]?.trim() === '') {
		lines.shift();
	}

	while (lines[lines.length - 1]?.trim() === '') {
		lines.pop();
	}

	if (lines.length === 0) {
		return '';
	}

	const sanitizedLines = lines.map((line) => {
		if (!line.trim()) {
			return '';
		}

		const indentation = line.match(/^(\s*)/u)?.[1] || '';
		const content = line.trimStart();
		return `${indentation}${stripBodyLabels(content)}`;
	});

	const compactedLines: string[] = [];
	let previousBlank = false;
	for (const line of sanitizedLines) {
		const isBlank = line.trim() === '';
		if (isBlank && previousBlank) {
			continue;
		}

		compactedLines.push(isBlank ? '' : line);
		previousBlank = isBlank;
	}

	const compactedBody = compactedLines.join('\n');
	if (hasExplicitMarkdownLineSyntax(compactedBody)) {
		// For markdown style, keep author/model line breaks and avoid width reflow.
		return compactedBody;
	}

	const normalizedBody = normalizeDetailedBody(compactedBody);
	if (normalizedBody.listItems.length > 0) {
		return normalizedBody.listItems
			.slice(0, 6)
			.map(item => `${listItemPrefix}${item}`)
			.join('\n');
	}

	// For markdown style, keep author/model line breaks and avoid width reflow.
	return compactedBody;
};

export const formatDetailedBodyWithColumnGuide = (
	normalizedBody: ReturnType<typeof normalizeDetailedBody>,
	detailsStyle: Exclude<DetailsStyle, 'markdown'>,
	detailColumnGuide: number,
) => {
	const resolvedGuide = resolveDetailColumnGuide(detailColumnGuide);

	if (detailsStyle === 'list') {
		return normalizedBody.listItems
			.slice(0, 6)
			.map(item => formatListItemWithColumnGuide(item, resolvedGuide))
			.join('\n');
	}

	return wrapTextByColumns(normalizedBody.paragraph, resolvedGuide)
		.join('\n');
};

const sanitizeMessage = (
	message: string,
	_includeDetails?: boolean,
	_detailsStyle?: DetailsStyle,
	_detailColumnGuide?: number,
) => {
	const cleaned = stripCodeFences(message);
	const { title, body } = splitCommitMessage(cleaned);
	if (!title) {
		return '';
	}

	const normalizedBody = normalizeLineEndings(body)
		.split('\n')
		.map(line => line.replace(/\s+$/u, ''))
		.join('\n')
		.trim();

	return normalizedBody
		? formatCommitMessage(title, normalizedBody)
		: title;
};

export type CommitMessageStreamPhase = 'message';
export type CommitMessageStreamEvent = CompletionStreamEvent & {
	phase: CommitMessageStreamPhase;
};
export type GenerateCommitMessageOptions = PromptOptions & {
	onStreamEvent?: (event: CommitMessageStreamEvent) => void;
	requestOptionsJson?: string;
	apiMode?: ApiMode;
	reasoningEffort?: ConfiguredReasoningEffort;
	contextWindowTokens?: number;
};

const reasoningEffortLevels = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
type ExplicitReasoningEffort = typeof reasoningEffortLevels[number];

const normalizeExplicitReasoningEffort = (value: unknown): ExplicitReasoningEffort | undefined => {
	if (typeof value !== 'string') {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();
	return reasoningEffortLevels.includes(normalized as ExplicitReasoningEffort)
		? normalized as ExplicitReasoningEffort
		: undefined;
};

const parseRequestOptionsJson = (
	requestOptionsJson: string | undefined,
	apiMode: ApiMode,
) => {
	if (!requestOptionsJson?.trim()) {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(requestOptionsJson);
	} catch {
		throw new KnownError('Invalid config property request-options: Must be valid JSON');
	}

	if (
		typeof parsed !== 'object'
		|| parsed === null
		|| Array.isArray(parsed)
	) {
		throw new KnownError('Invalid config property request-options: Must be a JSON object');
	}

	const requestOptions = {
		...parsed as Record<string, unknown>,
	};

	// These fields are managed by internal generation logic.
	delete requestOptions.model;
	delete requestOptions.messages;
	delete requestOptions.input;
	delete requestOptions.instructions;
	delete requestOptions.stream;

	if (apiMode === 'responses') {
		const flatReasoningEffort = normalizeExplicitReasoningEffort(requestOptions.reasoning_effort);
		if (
			flatReasoningEffort
			&& (
				typeof requestOptions.reasoning !== 'object'
				|| requestOptions.reasoning === null
				|| Array.isArray(requestOptions.reasoning)
			)
		) {
			requestOptions.reasoning = {
				effort: flatReasoningEffort,
			};
		} else if (
			flatReasoningEffort
			&& typeof requestOptions.reasoning === 'object'
			&& requestOptions.reasoning !== null
			&& !Array.isArray(requestOptions.reasoning)
			&& normalizeExplicitReasoningEffort(
				(requestOptions.reasoning as Record<string, unknown>).effort,
			) === undefined
		) {
			requestOptions.reasoning = {
				...(requestOptions.reasoning as Record<string, unknown>),
				effort: flatReasoningEffort,
			};
		}

		delete requestOptions.reasoning_effort;
		delete requestOptions.max_completion_tokens;
		return requestOptions;
	}

	const nestedReasoningEffort = (
		typeof requestOptions.reasoning === 'object'
		&& requestOptions.reasoning !== null
		&& !Array.isArray(requestOptions.reasoning)
	)
		? normalizeExplicitReasoningEffort((requestOptions.reasoning as Record<string, unknown>).effort)
		: undefined;
	if (
		nestedReasoningEffort
		&& normalizeExplicitReasoningEffort(requestOptions.reasoning_effort) === undefined
	) {
		requestOptions.reasoning_effort = nestedReasoningEffort;
	}

	delete requestOptions.reasoning;
	delete requestOptions.max_output_tokens;

	return requestOptions;
};

export const resolveRequestOptionsForApi = (
	requestOptionsJson: string | undefined,
	apiMode: ApiMode,
	reasoningEffort?: ConfiguredReasoningEffort,
) => {
	const requestOptions = parseRequestOptionsJson(requestOptionsJson, apiMode);

	if (!reasoningEffort) {
		return requestOptions;
	}

	if (apiMode === 'responses') {
		const nextReasoning = (
			typeof requestOptions.reasoning === 'object'
			&& requestOptions.reasoning !== null
			&& !Array.isArray(requestOptions.reasoning)
		)
			? requestOptions.reasoning as Record<string, unknown>
			: {};

		return {
			...requestOptions,
			reasoning: {
				...nextReasoning,
				effort: reasoningEffort,
			},
		};
	}

	return {
		...requestOptions,
		reasoning_effort: reasoningEffort,
	};
};

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

const maxPromptDiffChars = 120_000;
const minPromptDiffChars = 1024;
const estimatedDiffCharsPerToken = 3;
const promptOverheadReserveTokens = 900;
const completionReserveTokens = 700;
const titleRewriteReserveTokens = 450;
const contextWindowSafetyRatio = 0.85;
const diffCompactionNotice = '[Diff compacted to fit model context. Each file is represented with abbreviated hunks when needed.]';
const patchCompactionMarker = '@@ ... patch content truncated ... @@';

export const resolveDiffBudgetChars = (
	contextWindowTokens = 0,
) => {
	if (!Number.isInteger(contextWindowTokens) || contextWindowTokens <= 0) {
		return maxPromptDiffChars;
	}

	const reservedTokens = (
		promptOverheadReserveTokens
		+ completionReserveTokens
		+ titleRewriteReserveTokens
	);
	const availableTokens = Math.floor(
		(contextWindowTokens - reservedTokens) * contextWindowSafetyRatio,
	);
	const diffTokensBudget = Math.max(128, availableTokens);

	return Math.max(minPromptDiffChars, diffTokensBudget * estimatedDiffCharsPerToken);
};

const splitDiffIntoPatches = (diff: string) => {
	const patchHeaderRegex = /^diff --git .+$/gm;
	const headerMatches = Array.from(diff.matchAll(patchHeaderRegex));
	if (headerMatches.length === 0) {
		return [diff];
	}

	const patches: string[] = [];
	const firstHeaderIndex = headerMatches[0]?.index ?? 0;
	if (firstHeaderIndex > 0) {
		const preamble = diff.slice(0, firstHeaderIndex).trim();
		if (preamble) {
			patches.push(preamble);
		}
	}

	for (const [index, match] of headerMatches.entries()) {
		const start = match.index ?? 0;
		const end = headerMatches[index + 1]?.index ?? diff.length;
		const patch = diff.slice(start, end).trim();
		if (patch) {
			patches.push(patch);
		}
	}

	return patches;
};

const compactPatchToBudget = (
	patch: string,
	budget: number,
) => {
	if (budget <= 0) {
		return '';
	}

	if (patch.length <= budget) {
		return patch;
	}

	const markerCost = patchCompactionMarker.length + 2;
	if (budget <= markerCost) {
		return patch.slice(0, budget);
	}

	const contentBudget = budget - markerCost;
	const targetHeadBudget = Math.floor(contentBudget * 0.7);
	const minHeadBudget = Math.min(60, contentBudget);
	const minTailBudget = Math.min(40, Math.max(0, contentBudget - minHeadBudget));
	const headBudget = Math.max(
		minHeadBudget,
		Math.min(targetHeadBudget, contentBudget - minTailBudget),
	);
	const tailBudget = contentBudget - headBudget;
	if (tailBudget <= 0) {
		return patch.slice(0, budget);
	}

	const head = patch.slice(0, headBudget).trimEnd();
	const tail = patch.slice(-tailBudget).trimStart();

	if (!tail) {
		return patch.slice(0, budget);
	}

	return `${head}\n${patchCompactionMarker}\n${tail}`
		.slice(0, budget);
};

export const compactDiffForPrompt = (
	diff: string,
	maxChars = maxPromptDiffChars,
) => {
	const normalized = normalizeLineEndings(diff).trim();
	if (!normalized) {
		return normalized;
	}

	if (maxChars <= 0) {
		return '';
	}

	const noticeBudget = diffCompactionNotice.length + 2;
	if (normalized.length <= maxChars) {
		return normalized;
	}

	if (maxChars <= noticeBudget) {
		return normalized.slice(0, maxChars);
	}

	const availableBudget = maxChars - noticeBudget;
	const patches = splitDiffIntoPatches(normalized);
	if (patches.length <= 1) {
		const compactedSingle = compactPatchToBudget(normalized, availableBudget);
		return `${compactedSingle}\n\n${diffCompactionNotice}`;
	}

	const patchSeparator = '\n\n';
	const separatorCost = patchSeparator.length * Math.max(0, patches.length - 1);
	const availableForPatches = Math.max(1, availableBudget - separatorCost);
	const perPatchBudget = Math.max(1, Math.floor(availableForPatches / patches.length));
	const compactedPatches = patches
		.map(patch => compactPatchToBudget(patch, perPatchBudget))
		.filter(Boolean);
	const compactedDiff = compactedPatches.join(patchSeparator);

	return `${compactedDiff}\n\n${diffCompactionNotice}`;
};

export const generateCommitMessage = async (
	apiKey: string,
	model: TiktokenModel,
	diff: string,
	completions: number,
	timeout: number,
	proxy?: string,
	options?: GenerateCommitMessageOptions,
	baseUrl?: string,
) => {
	const resolvedOptions = options ?? { messageInstructionsMarkdown: '' };
	const apiMode = resolvedOptions.apiMode ?? 'responses';
	const requestOptions = resolveRequestOptionsForApi(
		resolvedOptions.requestOptionsJson,
		apiMode,
		resolvedOptions.reasoningEffort,
	);
	const diffBudgetChars = resolveDiffBudgetChars(resolvedOptions.contextWindowTokens);
	const compactedDiff = compactDiffForPrompt(diff, diffBudgetChars);
	const diffWasCompacted = compactedDiff.includes(diffCompactionNotice);
	const rewriteFeedbackHistory = resolveRewriteFeedbackHistory(resolvedOptions);
	const rewriteConversation = resolveRewriteConversation(resolvedOptions);

	try {
		const instructions = buildCommitMessageInstructions({
			messageInstructionsMarkdown: resolvedOptions.messageInstructionsMarkdown || '',
			changedFiles: resolvedOptions.changedFiles,
			diffWasCompacted,
			rewriteFromMessage: resolvedOptions.rewriteFromMessage,
			rewriteFeedback: resolvedOptions.rewriteFeedback,
			rewriteFeedbackHistory,
			rewriteConversation,
		});

		const requestCount = Math.max(1, completions);
		const completionResponses = await Promise.all(
			Array.from({ length: requestCount }, () => (
				apiMode === 'responses'
					? createResponsesResponse(
						apiKey,
						createMinimalResponsesRequest(
							model,
							instructions,
							buildCommitMessageResponsesInput(
								compactedDiff,
								{
									rewriteConversation,
									rewriteFromMessage: resolvedOptions.rewriteFromMessage,
									rewriteFeedback: resolvedOptions.rewriteFeedback,
									rewriteFeedbackHistory,
								},
							),
						),
						timeout,
						proxy,
						baseUrl,
						event => resolvedOptions.onStreamEvent?.({
							phase: 'message',
							...event,
						}),
						requestOptions,
					)
					: createChatCompletion(
						apiKey,
						createMinimalChatRequest(
							model,
							buildCommitMessageChatMessages(
								instructions,
								compactedDiff,
								{
									rewriteConversation,
									rewriteFromMessage: resolvedOptions.rewriteFromMessage,
									rewriteFeedback: resolvedOptions.rewriteFeedback,
									rewriteFeedbackHistory,
								},
							),
						),
						timeout,
						proxy,
						baseUrl,
						event => resolvedOptions.onStreamEvent?.({
							phase: 'message',
							...event,
						}),
						requestOptions,
					)
			)),
		);

		const messages = completionResponses
			.flatMap(completion => completion.choices)
			.flatMap((choice) => {
				const content = choice.message?.content;
				if (typeof content !== 'string') {
					return [];
				}

				const sanitized = sanitizeMessage(
					stripReasoningBlocksFromContent(content),
				);

				return sanitized ? [sanitized] : [];
			});

		return deduplicateMessages(messages);
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`);
		}

		throw errorAsAny;
	}
};

export const buildCommitMessageInstructions = (
	options: PromptOptions,
) => generatePrompt({
	messageInstructionsMarkdown: options.messageInstructionsMarkdown || '',
	changedFiles: options.changedFiles,
	diffWasCompacted: options.diffWasCompacted,
	rewriteFromMessage: options.rewriteFromMessage,
	rewriteFeedback: options.rewriteFeedback,
	rewriteFeedbackHistory: options.rewriteFeedbackHistory,
	rewriteConversation: options.rewriteConversation,
});
