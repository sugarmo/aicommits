import path from 'path';
import { execa } from 'execa';
import { KnownError } from './error.js';

const runGitRevParse = async (
	args: string[],
	cwd?: string,
) => {
	const { stdout, failed } = await execa('git', ['rev-parse', ...args], {
		reject: false,
		cwd,
	});

	if (failed) {
		throw new KnownError('The current directory must be a Git repository!');
	}

	return stdout.trim();
};

export const assertGitRepo = async () => runGitRevParse(['--show-toplevel']);

export const getGitPath = async (
	gitPath: string,
	cwd?: string,
) => {
	const workingDirectory = cwd || process.cwd();
	const resolvedGitPath = await runGitRevParse(['--git-path', gitPath], workingDirectory);

	if (path.isAbsolute(resolvedGitPath)) {
		return resolvedGitPath;
	}

	return path.resolve(workingDirectory, resolvedGitPath);
};

const excludeFromDiff = (filePath: string) => `:(exclude)${filePath}`;

type DiffSource = 'staged' | 'uncommitted';

export type GitDiff = {
	diff: string;
	files: string[];
	source: DiffSource;
};

const filesToExclude = [
	'package-lock.json',
	'pnpm-lock.yaml',

	// yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
	'*.lock',
].map(excludeFromDiff);

const parseFiles = (rawFiles: string) => rawFiles.split('\n').filter(Boolean);

const getExcludePathspecs = (excludeFiles?: string[]) => [
	...filesToExclude,
	...(
		excludeFiles
			? excludeFiles.map(excludeFromDiff)
			: []
	),
];

const buildDiff = async (
	diffArgs: string[],
	excludeFiles?: string[],
	cwd?: string,
) => {
	const excludePathspecs = getExcludePathspecs(excludeFiles);
	const { stdout: files } = await execa(
		'git',
		[
			...diffArgs,
			'--name-only',
			...excludePathspecs,
		],
		{
			cwd,
		},
	);

	if (!files) {
		return;
	}

	const { stdout: diff } = await execa(
		'git',
		[
			...diffArgs,
			...excludePathspecs,
		],
		{
			cwd,
		},
	);

	return {
		files: parseFiles(files),
		diff,
	};
};

const getUntrackedFiles = async (
	excludeFiles?: string[],
	cwd?: string,
) => {
	const { stdout } = await execa(
		'git',
		[
			'ls-files',
			'--others',
			'--exclude-standard',
			'--',
			'.',
			...getExcludePathspecs(excludeFiles),
		],
		{
			cwd,
		},
	);

	if (!stdout) {
		return [];
	}

	return parseFiles(stdout);
};

const getUntrackedDiff = async (
	files: string[],
	cwd?: string,
) => {
	if (files.length === 0) {
		return '';
	}

	const patches: string[] = [];
	for (const file of files) {
		// `git diff --no-index` exits with code 1 when differences are found.
		const { stdout } = await execa(
			'git',
			[
				'diff',
				'--no-index',
				'--diff-algorithm=minimal',
				'--',
				'/dev/null',
				file,
			],
			{
				reject: false,
				cwd,
			},
		);

		if (stdout) {
			patches.push(stdout);
		}
	}

	return patches.join('\n\n');
};

export const hasStagedChanges = async (cwd?: string) => {
	const { stdout } = await execa(
		'git',
		[
			'diff',
			'--cached',
			'--name-only',
		],
		{
			cwd,
		},
	);

	return stdout.trim().length > 0;
};

export const getStagedDiff = async (
	excludeFiles?: string[],
	cwd?: string,
): Promise<GitDiff | undefined> => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];
	const staged = await buildDiff(diffCached, excludeFiles, cwd);
	if (!staged) {
		return;
	}

	return { ...staged, source: 'staged' };
};

export const getUncommittedDiff = async (
	excludeFiles?: string[],
	cwd?: string,
): Promise<GitDiff | undefined> => {
	const diffWorkingTree = ['diff', '--diff-algorithm=minimal'];
	const unstaged = await buildDiff(diffWorkingTree, excludeFiles, cwd);
	const untrackedFiles = await getUntrackedFiles(excludeFiles, cwd);

	if (!unstaged && untrackedFiles.length === 0) {
		return;
	}

	const untrackedDiff = await getUntrackedDiff(untrackedFiles, cwd);
	const files = Array.from(
		new Set([
			...(unstaged?.files ?? []),
			...untrackedFiles,
		]),
	);
	const diff = [
		unstaged?.diff,
		untrackedDiff,
	]
		.filter(Boolean)
		.join('\n\n');

	return {
		files,
		diff,
		source: 'uncommitted',
	};
};

export const getDiffForRequest = async (
	excludeFiles?: string[],
	cwd?: string,
) => {
	const staged = await getStagedDiff(excludeFiles, cwd);
	if (staged) {
		return staged;
	}

	// If there are staged files that were filtered out, keep the previous behavior.
	if (await hasStagedChanges(cwd)) {
		return;
	}

	return getUncommittedDiff(excludeFiles, cwd);
};

export const getDetectedMessage = (
	files: string[],
	source: DiffSource = 'staged',
) => `Detected ${files.length.toLocaleString()} ${source} file${files.length > 1 ? 's' : ''}`;
