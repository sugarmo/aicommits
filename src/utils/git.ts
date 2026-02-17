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

const filesToExclude = [
	'package-lock.json',
	'pnpm-lock.yaml',

	// yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
	'*.lock',
].map(excludeFromDiff);

export const getStagedDiff = async (excludeFiles?: string[]) => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];
	const { stdout: files } = await execa(
		'git',
		[
			...diffCached,
			'--name-only',
			...filesToExclude,
			...(
				excludeFiles
					? excludeFiles.map(excludeFromDiff)
					: []
			),
		],
	);

	if (!files) {
		return;
	}

	const { stdout: diff } = await execa(
		'git',
		[
			...diffCached,
			...filesToExclude,
			...(
				excludeFiles
					? excludeFiles.map(excludeFromDiff)
					: []
			),
		],
	);

	return {
		files: files.split('\n'),
		diff,
	};
};

export const getDetectedMessage = (files: string[]) => `Detected ${files.length.toLocaleString()} staged file${files.length > 1 ? 's' : ''}`;
