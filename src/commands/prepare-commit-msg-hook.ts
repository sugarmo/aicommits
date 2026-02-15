import fs from 'fs/promises';
import {
	intro, outro,
} from '@clack/prompts';
import {
	black, dim, green, red, bgCyan,
} from 'kolorist';
import { getStagedDiff } from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { generateCommitMessage, type CommitMessageStreamEvent } from '../utils/openai.js';
import { createAnimatedStatusSpinner, type AnimatedStatusSpinner } from '../utils/animated-status-spinner.js';
import { KnownError, handleCliError } from '../utils/error.js';

const [messageFilePath, commitSource] = process.argv.slice(2);

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
	const intervalMs = 1_000;

	const render = () => spinner.update(`Thinking for ${formatThinkingDuration(Date.now() - startedAt)} (${model})`);
	render();
	const intervalId = setInterval(render, intervalMs);

	return () => clearInterval(intervalId);
};

export default () => (async () => {
	if (!messageFilePath) {
		throw new KnownError('Commit message file path is missing. This file should be called from the "prepare-commit-msg" git hook');
	}

	// If a commit message is passed in, ignore
	if (commitSource) {
		return;
	}

	// All staged files can be ignored by our filter
	const staged = await getStagedDiff();
	if (!staged) {
		return;
	}

	intro(bgCyan(black(' aicommits ')));

	const config = await getConfig({
	});

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
		const promptOptions = {
			includeDetails: config.details,
			detailsStyle: config['details-style'],
			instructions: config.instructions,
			conventionalFormat: config['conventional-format'],
			conventionalTypes: config['conventional-types'],
			conventionalScope: config['conventional-scope'],
			changedFiles: staged.files,
		};

		messages = await generateCommitMessage(
			config['api-key'],
			config.model,
			config.locale,
			staged!.diff,
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

	/**
	 * When `--no-edit` is passed in, the base commit message is empty,
	 * and even when you use pass in comments via #, they are ignored.
	 *
	 * Note: `--no-edit` cannot be detected in argvs so this is the only way to check
	 */
	const baseMessage = await fs.readFile(messageFilePath, 'utf8');
	const supportsComments = baseMessage !== '';
	const hasMultipleMessages = messages.length > 1;

	let instructions = '';

	if (supportsComments) {
		instructions = `# 🤖 AI generated commit${hasMultipleMessages ? 's' : ''}\n`;
	}

	if (hasMultipleMessages) {
		if (supportsComments) {
			instructions += '# Select one of the following messages by uncommeting:\n';
		}
		instructions += `\n${messages.map(message => `# ${message}`).join('\n')}`;
	} else {
		if (supportsComments) {
			instructions += '# Edit the message below and commit:\n';
		}
		instructions += `\n${messages[0]}\n`;
	}

	await fs.appendFile(
		messageFilePath,
		instructions,
	);
	outro(`${green('✔')} Saved commit message!`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	handleCliError(error);
	process.exit(1);
});
