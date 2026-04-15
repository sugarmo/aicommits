import { execa } from 'execa';
import {
	black, dim, green, red, bgCyan,
} from 'kolorist';
import {
	intro, outro,
} from '@clack/prompts';
import {
	assertGitRepo,
	getDiffForRequest,
	getDetectedMessage,
} from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import {
	generateCommitMessage,
	type CommitMessageStreamEvent,
} from '../utils/openai.js';
import { createAnimatedStatusSpinner, type AnimatedStatusSpinner } from '../utils/animated-status-spinner.js';
import { KnownError, handleCliError } from '../utils/error.js';
import { applyPostResponseScript } from '../utils/post-response.js';
import { promptForCommitMessage } from '../utils/commit-message-prompt.js';

const formatThinkingDuration = (elapsedMs: number) => {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`;
	}

	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}

	return `${seconds}s`;
};

const createThinkingTicker = (spinner: AnimatedStatusSpinner, model: string) => {
	const startedAt = Date.now();
	const intervalMs = 1000;

	const render = () => spinner.update(`The AI (${model}) is thinking for ${formatThinkingDuration(Date.now() - startedAt)}`);
	render();
	const intervalId = setInterval(render, intervalMs);

	return () => clearInterval(intervalId);
};

export default async (
	generate: number | undefined,
	excludeFiles: string[],
	stageAll: boolean,
	showReasoning: boolean | undefined,
	reasoningEffort: string | undefined,
	apiMode: string | undefined,
	messageFile: string | undefined,
	postResponseScript: string | undefined,
	baseUrl: string | undefined,
	autoConfirm: boolean | undefined,
	rawArgv: string[],
) => (async () => {
	intro(bgCyan(black(' aicommits ')));
	await assertGitRepo();

	const detectingFiles = createAnimatedStatusSpinner();

	if (stageAll) {
		// This should be equivalent behavior to `git commit --all`
		await execa('git', ['add', '--update']);
	}

	detectingFiles.start('Detecting git changes');
	const changes = await getDiffForRequest(excludeFiles);

	if (!changes) {
		detectingFiles.stop('Detecting git changes');
		throw new KnownError('No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.');
	}

	detectingFiles.stop(`${getDetectedMessage(changes.files, changes.source)}:\n${changes.files.map(file => `  ${file}`).join('\n')
		}`);

	const config = await getConfig({
		generate: generate?.toString(),
		'show-reasoning': showReasoning === true ? 'true' : undefined,
		'reasoning-effort': reasoningEffort,
		'api-mode': apiMode,
		'message-path': messageFile,
		'post-response-script': postResponseScript,
		'base-url': baseUrl,
	});

	const promptOptions = {
		messageInstructionsMarkdown: config.messageInstructionsMarkdown,
		reasoningEffort: config['reasoning-effort'],
		requestOptionsJson: config['request-options'],
		apiMode: config['api-mode'],
		contextWindowTokens: config['context-window'],
		changedFiles: changes.files,
	};

	const showReasoningStream = config['show-reasoning'] === true;
	const generateMessages = async ({
		completions = config.generate,
		rewriteFromMessage,
		rewriteFeedback,
		rewriteFeedbackHistory,
		rewriteConversation,
		statusMessage = `The AI (${config.model}) is analyzing your changes`,
		finishedMessage = 'Changes analyzed',
	}: {
		completions?: number;
		rewriteFromMessage?: string;
		rewriteFeedback?: string;
		rewriteFeedbackHistory?: string[];
		rewriteConversation?: Array<{
			role: 'assistant' | 'user';
			content: string;
		}>;
		statusMessage?: string;
		finishedMessage?: string;
	} = {}) => {
		const s = createAnimatedStatusSpinner();
		s.start(statusMessage);
		let stopThinkingTicker: (() => void) | undefined;
		let thinkingTickerStarted = false;
		let spinnerOpen = true;
		let reasoningStarted = false;
		let activeReasoningPhase: CommitMessageStreamEvent['phase'] | undefined;
		const phaseLabels: Record<CommitMessageStreamEvent['phase'], string> = {
			message: 'Message Generation',
		};
		const handleStreamEvent = (event: CommitMessageStreamEvent) => {
			if (event.kind !== 'reasoning' || !event.text) {
				return;
			}

			if (!showReasoningStream) {
				if (!thinkingTickerStarted) {
					stopThinkingTicker = createThinkingTicker(s, config.model);
					thinkingTickerStarted = true;
				}
				return;
			}

			if (spinnerOpen) {
				s.stop(`The AI (${config.model}) is thinking`);
				spinnerOpen = false;
			}

			if (!reasoningStarted) {
				process.stdout.write(`${dim(`\nThe AI (${config.model}) is thinking`)}\n`);
				reasoningStarted = true;
			}

			if (event.phase !== activeReasoningPhase) {
				activeReasoningPhase = event.phase;
				process.stdout.write(`${dim(`[${phaseLabels[event.phase]}]\n`)}`);
			}

			process.stdout.write(event.text);
		};

		let nextMessages: string[];
		try {
			nextMessages = await generateCommitMessage(
				config['api-key'],
				config.model,
				changes.diff,
				completions,
				config.timeout,
				config.proxy,
				{
					...promptOptions,
					rewriteFromMessage,
					rewriteFeedback,
					rewriteFeedbackHistory,
					rewriteConversation,
					onStreamEvent: handleStreamEvent,
				},
				config['base-url'],
			);
		} finally {
			stopThinkingTicker?.();
			if (spinnerOpen) {
				s.stop(finishedMessage);
			} else if (showReasoningStream) {
				process.stdout.write('\n');
			}
		}

		if (nextMessages.length === 0) {
			throw new KnownError('No commit messages were generated. Try again.');
		}

		return Promise.all(nextMessages.map((candidate, index) => applyPostResponseScript(
			candidate,
			config.postResponseScriptPath,
			{
				candidateCount: nextMessages.length,
				candidateIndex: index,
				commitSource: 'cli',
				configDirectoryPath: config.configDirectoryPath,
				cwd: process.cwd(),
				messageFilePath: config.messageFilePath,
			},
		)));
	};

	let messages = await generateMessages();
	let rewriteFeedbackHistory: string[] = [];
	let rewriteConversation: Array<{
		role: 'assistant' | 'user';
		content: string;
	}> = [];

	let message = '';

	if (autoConfirm) {
		[message] = messages;
	} else {
		try {
			let reviewingMessage = true;
			while (reviewingMessage) {
				const promptResult = await promptForCommitMessage(messages);

				if (promptResult.status === 'cancelled') {
					outro('Commit cancelled');
					return;
				}

				if (promptResult.status === 'submitted') {
					message = promptResult.message;
					reviewingMessage = false;
					break;
				}

				rewriteFeedbackHistory = [
					...rewriteFeedbackHistory,
					promptResult.feedback,
				];
				rewriteConversation = [
					...rewriteConversation,
					{
						role: 'assistant',
						content: promptResult.message,
					},
					{
						role: 'user',
						content: promptResult.feedback,
					},
				];
				messages = await generateMessages({
					completions: 1,
					rewriteFromMessage: promptResult.message,
					rewriteFeedback: promptResult.feedback,
					rewriteFeedbackHistory,
					rewriteConversation,
					statusMessage: `The AI (${config.model}) is revising your commit message`,
					finishedMessage: 'Commit message revised',
				});
			}
		} catch (error) {
			const messageText = error instanceof Error ? error.message : '';
			const isTtyInitializationError = messageText.includes('TTY initialization failed')
				|| messageText.includes('uv_tty_init returned EINVAL')
				|| messageText.includes('ERR_TTY_INIT_FAILED');

			if (isTtyInitializationError) {
				throw new KnownError('Interactive terminal initialization failed in this environment. Re-run with `--confirm` or `--yes` to skip prompts.');
			}

			throw error;
		}
	}

	// In fallback mode, stage uncommitted files only after message acceptance,
	// right before running `git commit`.
	if (changes.source === 'uncommitted') {
		await execa('git', ['add', '--all', '--', ...changes.files]);
	}

	await execa('git', ['commit', '-m', message, ...rawArgv]);

	outro(`${green('✔')} Successfully committed!`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	handleCliError(error);
	process.exit(1);
});
