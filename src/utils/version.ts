import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { version as packageVersion } from '../../package.json';

const LOCAL_VERSION_PLACEHOLDER = '0.0.0-semantic-release';

const resolveProjectRoot = (anchorUrl?: string) => {
	if (!anchorUrl) {
		return process.cwd();
	}

	try {
		let current = path.dirname(fileURLToPath(anchorUrl));
		const { root } = path.parse(current);

		while (true) {
			const pkgPath = path.join(current, 'package.json');
			if (fs.existsSync(pkgPath)) {
				return current;
			}

			if (current === root) {
				break;
			}

			current = path.dirname(current);
		}
	} catch {
		// Fall back below.
	}

	return process.cwd();
};

const getGitShortSha = (anchorUrl?: string) => {
	const cwd = resolveProjectRoot(anchorUrl);

	try {
		return execSync('git rev-parse --short HEAD', {
			cwd,
			stdio: ['ignore', 'pipe', 'ignore'],
		})
			.toString()
			.trim();
	} catch {
		return '';
	}
};

const getBuildStamp = (anchorUrl?: string) => {
	if (!anchorUrl) {
		return '';
	}

	try {
		const filePath = fileURLToPath(anchorUrl);
		return String(Math.trunc(fs.statSync(filePath).mtimeMs));
	} catch {
		return '';
	}
};

export const getDisplayVersion = (anchorUrl?: string) => {
	if (packageVersion !== LOCAL_VERSION_PLACEHOLDER) {
		return packageVersion;
	}

	const tokens = ['local'];
	const gitSha = getGitShortSha(anchorUrl);
	if (gitSha) {
		tokens.push(gitSha);
	}

	const buildStamp = getBuildStamp(anchorUrl);
	if (buildStamp) {
		tokens.push(buildStamp);
	}

	return `${packageVersion}+${tokens.join('.')}`;
};
