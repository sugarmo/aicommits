import { dim } from 'kolorist';
import { repository } from '../../package.json';
import { getDisplayVersion } from './version.js';

const displayVersion = getDisplayVersion(import.meta.url);

export class KnownError extends Error {}

const indent = '    ';

const fallbackBugReportUrl = 'https://github.com/sugarmo/aicommits/issues/new/choose';

const normalizeRepositoryPath = (value: string) => value
	.trim()
	.replace(/^github:/, '')
	.replace(/^git\+/, '')
	.replace(/\.git$/, '');

const getGitHubRepositoryPath = (value: unknown): string | undefined => {
	if (typeof value === 'string') {
		const normalized = normalizeRepositoryPath(value);

		if (/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
			return normalized;
		}

		const sshMatch = normalized.match(/^git@github\.com:([^/\s]+\/[^/\s]+)$/);
		if (sshMatch?.[1]) {
			return sshMatch[1];
		}

		const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)$/);
		if (httpsMatch?.[1]) {
			return httpsMatch[1];
		}
	}

	if (
		value
		&& typeof value === 'object'
		&& 'url' in value
	) {
		return getGitHubRepositoryPath((value as { url?: unknown }).url);
	}
};

const bugReportUrl = (() => {
	const githubRepositoryPath = getGitHubRepositoryPath(repository);
	if (githubRepositoryPath) {
		return `https://github.com/${githubRepositoryPath}/issues/new/choose`;
	}

	return fallbackBugReportUrl;
})();

export const handleCliError = (error: any) => {
	if (
		error instanceof Error
		&& !(error instanceof KnownError)
	) {
		if (error.stack) {
			console.error(dim(error.stack.split('\n').slice(1).join('\n')));
		}
		console.error(`\n${indent}${dim(`aicommits v${displayVersion}`)}`);
		console.error(`\n${indent}Please open a Bug report with the information above:`);
		console.error(`${indent}${bugReportUrl}`);
	}
};
