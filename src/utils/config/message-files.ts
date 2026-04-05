import fs from 'fs/promises';
import path from 'path';
import { KnownError } from '../error.js';

export type MessageConfigRuntime = {
	messageFilePath: string;
	messageInstructionsMarkdown: string;
	postResponseScriptPath?: string;
};

type LoadMessageConfigOptions = {
	configDirectoryPath: string;
	messagePathValue: string;
	postResponseScriptValue: string;
	suppressErrors?: boolean;
};

const defaultMessageFileName = 'message.md';

const defaultMessageInstructionsMarkdown = [
	'# Commit Message Instructions',
	'',
	'## Language',
	'- Write the commit message in English.',
	'',
	'## Format',
	'- Output a plain git commit title, not a conventional commit prefix.',
	'- Return only a single title line with no body.',
	'- Use concise imperative wording.',
	'',
	'## Focus',
	'- Lead with the dominant user-facing, product-facing, or operational outcome.',
	'- Prefer the end result over the implementation mechanism.',
	'- Describe what the change enables, fixes, prevents, or improves.',
	'- Mention a concrete file, module, class, or subsystem only when it helps disambiguate the change.',
	'',
	'## Constraints',
	'- Keep the title around 50 characters when practical.',
	'- Avoid vague subjects like "update", "improve", "refactor", or "cleanup" unless the diff is genuinely dominated by maintenance work.',
].join('\n');

export const resolveConfigRelativePath = (
	configDirectoryPath: string,
	rawPath: string | undefined,
	fallbackPath = '',
) => {
	const normalized = rawPath?.trim() || fallbackPath.trim();
	if (!normalized) {
		return '';
	}

	return path.isAbsolute(normalized)
		? normalized
		: path.join(configDirectoryPath, normalized);
};

const ensureParentDirectory = async (targetPath: string) => {
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
};

const ensureRegularFileExists = async (
	targetPath: string,
	description: string,
) => {
	let stats;
	try {
		stats = await fs.lstat(targetPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new KnownError(`${description} was not created: ${targetPath}`);
		}

		throw error;
	}

	if (!stats.isFile()) {
		throw new KnownError(`${description} must point to a file: ${targetPath}`);
	}
};

const writeFileIfMissing = async (
	targetPath: string,
	content: string,
) => {
	try {
		const stats = await fs.lstat(targetPath);
		if (!stats.isFile()) {
			throw new KnownError(`Message Markdown file must point to a file: ${targetPath}`);
		}

		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}

	await ensureParentDirectory(targetPath);
	await fs.writeFile(targetPath, `${content.trimEnd()}\n`, 'utf8');
	await ensureRegularFileExists(targetPath, 'Message Markdown file');
};

const readMessageInstructionsMarkdown = async (
	configDirectoryPath: string,
	messagePathValue: string,
) => {
	const resolvedMessagePath = resolveConfigRelativePath(
		configDirectoryPath,
		messagePathValue,
		defaultMessageFileName,
	);
	await writeFileIfMissing(resolvedMessagePath, defaultMessageInstructionsMarkdown);
	const markdown = await fs.readFile(resolvedMessagePath, 'utf8');

	return {
		messageFilePath: resolvedMessagePath,
		messageInstructionsMarkdown: markdown,
	};
};

const resolvePostResponseScriptPath = (
	configDirectoryPath: string,
	scriptPathValue: string,
) => {
	const resolved = resolveConfigRelativePath(configDirectoryPath, scriptPathValue);
	return resolved || undefined;
};

export const loadMessageConfig = async ({
	configDirectoryPath,
	messagePathValue,
	postResponseScriptValue,
	suppressErrors = false,
}: LoadMessageConfigOptions): Promise<MessageConfigRuntime> => {
	if (suppressErrors) {
		try {
			const messageConfig = await readMessageInstructionsMarkdown(
				configDirectoryPath,
				messagePathValue,
			);

			return {
				...messageConfig,
				postResponseScriptPath: resolvePostResponseScriptPath(
					configDirectoryPath,
					postResponseScriptValue,
				),
			};
		} catch {
			return {
				messageFilePath: resolveConfigRelativePath(
					configDirectoryPath,
					messagePathValue,
					defaultMessageFileName,
				),
				messageInstructionsMarkdown: defaultMessageInstructionsMarkdown,
				postResponseScriptPath: resolvePostResponseScriptPath(
					configDirectoryPath,
					postResponseScriptValue,
				),
			};
		}
	}

	const messageConfig = await readMessageInstructionsMarkdown(
		configDirectoryPath,
		messagePathValue,
	);

	return {
		...messageConfig,
		postResponseScriptPath: resolvePostResponseScriptPath(
			configDirectoryPath,
			postResponseScriptValue,
		),
	};
};

export const getDeprecatedFlagError = (flag: string) => `Flag "${flag}" has been removed. Move commit message instructions into ~/.aicommits/message.md or point --message-file at another Markdown file.`;
