import { execa } from 'execa';
import { KnownError } from './error.js';

type PostResponseScriptContext = {
	candidateCount: number;
	candidateIndex: number;
	commitSource: 'cli' | 'hook';
	configDirectoryPath: string;
	cwd: string;
	messageFilePath: string;
};

const trimTrailingNewlines = (value: string) => value.replace(/\s+$/u, '');

export const applyPostResponseScript = async (
	message: string,
	scriptPath: string | undefined,
	context: PostResponseScriptContext,
) => {
	if (!scriptPath) {
		return message;
	}

	const execution = await execa(
		scriptPath,
		[],
		{
			cwd: context.cwd,
			input: message,
			reject: false,
			env: {
				AICOMMITS_CWD: context.cwd,
				AICOMMITS_CONFIG_DIR: context.configDirectoryPath,
				AICOMMITS_MESSAGE_FILE: context.messageFilePath,
				AICOMMITS_CANDIDATE_INDEX: String(context.candidateIndex),
				AICOMMITS_CANDIDATE_COUNT: String(context.candidateCount),
				AICOMMITS_COMMIT_SOURCE: context.commitSource,
			},
		},
	);

	if (execution.exitCode !== 0) {
		const stderr = execution.stderr.trim();
		throw new KnownError(
			stderr
				? `Post-response script failed: ${stderr}`
				: `Post-response script failed with exit code ${execution.exitCode}.`,
		);
	}

	const nextMessage = trimTrailingNewlines(execution.stdout);
	if (!nextMessage) {
		throw new KnownError('Post-response script produced an empty commit message.');
	}

	return nextMessage;
};
