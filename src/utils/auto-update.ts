import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface AutoUpdateOptions {
	pkg: { name: string; version: string };
	distTag?: string;
	headless?: boolean;
}

// Parse version string into comparable parts
// Supports: 1.2.3, 1.2.3-alpha, 1.2.3-alpha.1, 1.2.3-develop.14
function parseVersion(version: string): {
	major: number;
	minor: number;
	patch: number;
	prerelease: string | null;
	prereleaseNum: number;
} {
	// Remove 'v' prefix if present
	const cleanVersion = version.replace(/^v/, '');

	// Match: major.minor.patch[-prerelease.number]
	const match = cleanVersion.match(
		/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)(?:\.(\d+))?)?$/
	);

	if (!match) {
		return { major: 0, minor: 0, patch: 0, prerelease: null, prereleaseNum: 0 };
	}

	const [, major, minor, patch, prerelease, prereleaseNum] = match;
	return {
		major: parseInt(major, 10),
		minor: parseInt(minor, 10),
		patch: parseInt(patch, 10),
		prerelease: prerelease || null,
		prereleaseNum: prereleaseNum ? parseInt(prereleaseNum, 10) : 0,
	};
}

// Compare two versions
// Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
function compareVersions(v1: string, v2: string): number {
	const p1 = parseVersion(v1);
	const p2 = parseVersion(v2);

	// Compare major.minor.patch
	if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
	if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
	if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;

	// Handle prerelease versions
	// Stable > prerelease
	if (!p1.prerelease && p2.prerelease) return 1;
	if (p1.prerelease && !p2.prerelease) return -1;

	// Both are prereleases or both are stable
	if (!p1.prerelease && !p2.prerelease) return 0;

	// Compare prerelease numbers
	if (p1.prereleaseNum !== p2.prereleaseNum) {
		return p1.prereleaseNum > p2.prereleaseNum ? 1 : -1;
	}

	return 0;
}

// Fetch latest version from npm registry
async function fetchLatestVersion(
	packageName: string,
	distTag: string
): Promise<string | null> {
	try {
		const response = await fetch(
			`https://registry.npmjs.org/${packageName}/${distTag}`,
			{
				headers: {
					Accept: 'application/json',
				},
			}
		);

		if (!response.ok) {
			return null;
		}

		const data = await response.json();
		return data.version || null;
	} catch {
		return null;
	}
}

// Check if running as global installation
async function checkIfGlobalInstallation(packageName: string): Promise<boolean> {
	try {
		const { stdout } = await execAsync(`npm list -g ${packageName} --depth=0`);
		return stdout.includes(packageName);
	} catch {
		return false;
	}
}

// Run npm update in background
async function runBackgroundUpdate(
	packageName: string,
	distTag: string
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = exec(`npm install -g ${packageName}@${distTag}`, {
			timeout: 120000, // 2 minute timeout
			env: { ...process.env, NPM_CONFIG_PROGRESS: 'false' },
		});

		child.on('error', reject);

		child.on('exit', (code) => {
			if (code === 0 || code === null) {
				resolve();
			} else {
				reject(new Error(`npm install exited with code ${code}`));
			}
		});
	});
}

export async function checkAndAutoUpdate(
	options: AutoUpdateOptions
): Promise<void> {
	const { pkg, distTag = 'latest', headless = false } = options;

	if (headless) {
		return;
	}

	// Skip for development/semantic-release versions
	if (
		pkg.version === '0.0.0-semantic-release' ||
		pkg.version.includes('semantic-release')
	) {
		return;
	}

	// Determine correct dist tag based on current version
	const currentDistTag = pkg.version.includes('-') ? 'develop' : distTag;

	// Debug logging
	if (process.env.DEBUG || process.env.AICOMMITS_DEBUG) {
		console.log(`[auto-update] Current version: ${pkg.version}`);
		console.log(`[auto-update] Checking ${currentDistTag} tag...`);
	}

	// Fetch latest version from npm
	const latestVersion = await fetchLatestVersion(pkg.name, currentDistTag);

	if (!latestVersion) {
		if (process.env.DEBUG || process.env.AICOMMITS_DEBUG) {
			console.log('[auto-update] Could not fetch latest version');
		}
		return;
	}

	if (process.env.DEBUG || process.env.AICOMMITS_DEBUG) {
		console.log(`[auto-update] Latest version: ${latestVersion}`);
	}

	// Compare versions
	const comparison = compareVersions(pkg.version, latestVersion);

	if (comparison >= 0) {
		// Local version is same or newer
		if (process.env.DEBUG || process.env.AICOMMITS_DEBUG) {
			console.log('[auto-update] No update needed');
		}
		return;
	}

	// Update needed!
	console.log(`Updating aicommits from v${pkg.version} to v${latestVersion}...`);

	// Check if global installation
	const isGlobal = await checkIfGlobalInstallation(pkg.name);
	if (!isGlobal) {
		console.log(
			'Note: aicommits is installed locally. Auto-update skipped for local installations.'
		);
		return;
	}

	try {
		await runBackgroundUpdate(pkg.name, currentDistTag);
		console.log(`✓ aicommits updated to v${latestVersion}`);
		console.log('Please restart aic to use the new version.');
	} catch (error) {
		console.log('Auto-update failed. You can manually update with:');
		console.log(`  npm install -g aicommits@${currentDistTag}`);
	}
}
