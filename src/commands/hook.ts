import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { green, red } from 'kolorist';
import { command } from 'cleye';
import { assertGitRepo, getGitPath } from '../utils/git.js';
import { fileExists } from '../utils/fs.js';
import { KnownError, handleCliError } from '../utils/error.js';

const hookName = 'prepare-commit-msg';
const hookCommandName = 'prepare-commit-msg-hook';
const hookPathSuffix = `/hooks/${hookName}`;

const hookPath = fileURLToPath(new URL('cli.mjs', import.meta.url));
const hookScript = `
#!/usr/bin/env node
process.argv.splice(2, 0, ${JSON.stringify(hookCommandName)});
import(${JSON.stringify(pathToFileURL(hookPath))})
`.trim();

export const isCalledFromGitHook = (
	(process.argv[1] || '')
		.replace(/\\/g, '/') // Replace Windows back slashes with forward slashes
		.endsWith(hookPathSuffix)
);

const isManagedHookScript = async (absoluteHookPath: string) => {
	const scriptContent = await fs.readFile(absoluteHookPath, 'utf8').catch(() => undefined);
	return scriptContent === hookScript;
};

const isLegacyHookSymlink = async (absoluteHookPath: string) => {
	const realpath = await fs.realpath(absoluteHookPath).catch(() => undefined);
	return realpath === hookPath;
};

export default command({
	name: 'hook',
	parameters: ['<install/uninstall>'],
}, (argv) => {
	(async () => {
		const gitRepoPath = await assertGitRepo();
		const { installUninstall: mode } = argv._;

		const hooksPath = await getGitPath('hooks', gitRepoPath);
		const absoluteHookPath = path.join(hooksPath, hookName);
		const hookExists = await fileExists(absoluteHookPath);
		if (mode === 'install') {
			if (hookExists) {
				if (await isManagedHookScript(absoluteHookPath)) {
					console.warn('The hook is already installed');
					return;
				}

				if (await isLegacyHookSymlink(absoluteHookPath)) {
					await fs.rm(absoluteHookPath);
				} else {
					throw new KnownError(`A different ${hookName} hook seems to be installed. Please remove it before installing aicommits.`);
				}
			}

			await fs.mkdir(path.dirname(absoluteHookPath), { recursive: true });
			await fs.writeFile(absoluteHookPath, hookScript);
			await fs.chmod(absoluteHookPath, 0o755);
			console.log(`${green('✔')} Hook installed`);
			return;
		}

		if (mode === 'uninstall') {
			if (!hookExists) {
				console.warn('Hook is not installed');
				return;
			}

			const isManagedHook = (
				await isManagedHookScript(absoluteHookPath)
				|| await isLegacyHookSymlink(absoluteHookPath)
			);
			if (!isManagedHook) {
				console.warn('Hook is not installed');
				return;
			}

			await fs.rm(absoluteHookPath);
			console.log(`${green('✔')} Hook uninstalled`);
			return;
		}

		throw new KnownError(`Invalid mode: ${mode}`);
	})().catch((error) => {
		console.error(`${red('✖')} ${error.message}`);
		handleCliError(error);
		process.exit(1);
	});
});
