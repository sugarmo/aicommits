import fs from 'fs/promises';
import { execa } from 'execa';
import { getStagedDiff } from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { generateCommitMessage } from '../utils/openai.js';

const hookCommandName = 'prepare-commit-msg-hook';

const parseHookArguments = () => {
	const rawArgs = process.argv.slice(2);
	if (rawArgs[0] === hookCommandName) {
		return rawArgs.slice(1);
	}
	return rawArgs;
};

const getFallbackMessageFilePath = async () => {
	const { stdout } = await execa(
		'git',
		['rev-parse', '--git-path', 'COMMIT_EDITMSG'],
		{
			reject: false,
		},
	);

	const fallbackPath = stdout.trim();
	return fallbackPath === '' ? undefined : fallbackPath;
};

const readBaseMessage = async (messageFilePath: string) => fs.readFile(
	messageFilePath,
	'utf8',
).catch((error: NodeJS.ErrnoException) => {
	if (error.code === 'ENOENT') {
		return '';
	}
	throw error;
});

export default () => (async () => {
	const [messageFilePathArg, commitSource] = parseHookArguments();
	const messageFilePath = messageFilePathArg?.trim() || await getFallbackMessageFilePath();

	// No valid message file path: silently skip to avoid polluting Git client output.
	if (!messageFilePath) {
		return;
	}

	const baseMessage = await readBaseMessage(messageFilePath);
	const isExplicitMessage = commitSource === 'message';
	if (isExplicitMessage && baseMessage.trim() !== '') {
		return;
	}

	// All staged files can be ignored by our filter.
	const staged = await getStagedDiff();
	if (!staged) {
		return;
	}

	const config = await getConfig({
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

	const messages = await generateCommitMessage(
		config['api-key'],
		config.model,
		config.locale,
		staged.diff,
		config.generate,
		config['max-length'],
		config.type,
		config.timeout,
		config.proxy,
		promptOptions,
		config['base-url'],
	);
	if (messages.length === 0) {
		return;
	}
	const finalMessage = messages[0]?.trim();
	if (!finalMessage) {
		return;
	}
	const finalOutput = `${finalMessage}\n`;

	await fs.writeFile(
		messageFilePath,
		finalOutput,
	);

	// Some Git clients rely on hook stdout to display/update the message preview.
	process.stdout.write(finalOutput);
})().catch(() => {
	/**
	 * Hooks should avoid writing noisy output to Git clients.
	 * Swallow errors and keep default commit flow unchanged.
	 */
});
