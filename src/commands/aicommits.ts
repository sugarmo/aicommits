import { execa } from 'execa';
import {
	black, dim, green, red, bgCyan,
} from 'kolorist';
import {
	intro, outro, select, confirm, isCancel,
} from '@clack/prompts';
import {
	assertGitRepo,
	getStagedDiff,
	getDetectedMessage,
} from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { generateCommitMessage, type CommitMessageStreamEvent } from '../utils/openai.js';
import { createAnimatedStatusSpinner, type AnimatedStatusSpinner } from '../utils/animated-status-spinner.js';
import { KnownError, handleCliError } from '../utils/error.js';

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

	const render = () => spinner.update(`Thinking for ${formatThinkingDuration(Date.now() - startedAt)} (${model})`);
	render();
	const intervalId = setInterval(render, intervalMs);

	return () => clearInterval(intervalId);
};

export default async (
	generate: number | undefined,
	excludeFiles: string[],
	stageAll: boolean,
	commitType: string | undefined,
	includeDetails: boolean | undefined,
	showReasoning: boolean | undefined,
	detailsStyle: string | undefined,
	customInstructions: string | undefined,
	conventionalFormat: string | undefined,
	conventionalTypes: string | undefined,
	conventionalScope: string | undefined,
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

	detectingFiles.start('Detecting staged files');
	const staged = await getStagedDiff(excludeFiles);

	if (!staged) {
		detectingFiles.stop('Detecting staged files');
		throw new KnownError('No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.');
	}

	detectingFiles.stop(`${getDetectedMessage(staged.files)}:\n${staged.files.map(file => `  ${file}`).join('\n')
		}`);

	const config = await getConfig({
		generate: generate?.toString(),
		type: commitType?.toString(),
		details: includeDetails === true ? 'true' : undefined,
		'show-reasoning': showReasoning === true ? 'true' : undefined,
		'details-style': detailsStyle,
		instructions: customInstructions,
		'conventional-format': conventionalFormat,
		'conventional-types': conventionalTypes,
		'conventional-scope': conventionalScope,
		'base-url': baseUrl,
	});

	const promptOptions = {
		includeDetails: config.details,
		detailsStyle: config['details-style'],
		instructions: config.instructions,
		conventionalFormat: config['conventional-format'],
		conventionalTypes: config['conventional-types'],
		conventionalScope: config['conventional-scope'],
		changedFiles: staged.files,
	};

	const showReasoningStream = config['show-reasoning'] === true;
	const s = createAnimatedStatusSpinner();
	s.start(`The AI (${config.model}) is analyzing your changes`);
	let stopThinkingTicker: (() => void) | undefined;
	let thinkingTickerStarted = false;
	let spinnerOpen = true;
	let reasoningStarted = false;
	let activeReasoningPhase: CommitMessageStreamEvent['phase'] | undefined;
	const phaseLabels: Record<CommitMessageStreamEvent['phase'], string> = {
		message: 'Message Generation',
		'title-rewrite': 'Title Rewrite',
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
			s.stop(`Streaming reasoning from ${config.model}`);
			spinnerOpen = false;
		}

		if (!reasoningStarted) {
			process.stdout.write(`${dim(`\nReasoning stream (${config.model})`)}\n`);
			reasoningStarted = true;
		}

		if (event.phase !== activeReasoningPhase) {
			activeReasoningPhase = event.phase;
			process.stdout.write(`${dim(`[${phaseLabels[event.phase]}]\n`)}`);
		}

		process.stdout.write(event.text);
	};

	let messages: string[];
	try {
		messages = await generateCommitMessage(
			config['api-key'],
			config.model,
			config.locale,
			staged.diff,
			config.generate,
			config['max-length'],
			config.type,
			config.timeout,
			config.proxy,
			{
				...promptOptions,
				onStreamEvent: handleStreamEvent,
			},
			config['base-url'],
		);
	} finally {
		stopThinkingTicker?.();
		if (spinnerOpen) {
			s.stop('Changes analyzed');
		} else if (showReasoningStream) {
			process.stdout.write('\n');
		}
	}

	if (messages.length === 0) {
		throw new KnownError('No commit messages were generated. Try again.');
	}

	let message: string;

	if (autoConfirm) {
		[message] = messages;
	} else {
		try {
			if (messages.length === 1) {
				[message] = messages;
				const confirmed = await confirm({
					message: `Use this commit message?\n\n   ${message}\n`,
				});

				if (!confirmed || isCancel(confirmed)) {
					outro('Commit cancelled');
					return;
				}
			} else {
				const selected = await select({
					message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
					options: messages.map(value => ({ label: value, value })),
				});

				if (isCancel(selected)) {
					outro('Commit cancelled');
					return;
				}

				message = selected as string;
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

	await execa('git', ['commit', '-m', message, ...rawArgv]);

	outro(`${green('✔')} Successfully committed!`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	handleCliError(error);
	process.exit(1);
});
