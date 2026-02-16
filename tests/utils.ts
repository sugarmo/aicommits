import path from 'path';
import fs from 'fs/promises';
import { execa, execaNode, type Options } from 'execa';
import type { TiktokenModel } from '@dqbd/tiktoken';
import {
	createFixture as createFixtureBase,
	type FileTree,
	type FsFixture,
} from 'fs-fixture';

const aicommitsPath = path.resolve('./dist/cli.mjs');

const TEST_PROVIDER_API_KEY = (
	process.env.AICOMMITS_TEST_API_KEY
	|| process.env.AICOMMITS_API_KEY
	|| process.env.OPENAI_API_KEY
	|| process.env.OPENAI_KEY
	|| ''
).trim();

const TEST_PROVIDER_BASE_URL = (
	process.env.AICOMMITS_TEST_BASE_URL
	|| process.env.AICOMMITS_BASE_URL
	|| process.env.OPENAI_BASE_URL
	|| 'https://api.openai.com/v1'
).trim();

const TEST_PROVIDER_MODEL = (
	process.env.AICOMMITS_TEST_MODEL
	|| process.env.AICOMMITS_MODEL
	|| process.env.OPENAI_MODEL
	|| 'gpt-4o-mini'
).trim() as TiktokenModel;

const createAicommits = (fixture: FsFixture) => {
	const homeEnv = {
		HOME: fixture.path, // Linux
		USERPROFILE: fixture.path, // Windows
	};

	return (
		args?: string[],
		options?: Options,
	) => execaNode(aicommitsPath, args, {
		cwd: fixture.path,
		...options,
		extendEnv: false,
		env: {
			...homeEnv,
			...options?.env,
		},

		// Block tsx nodeOptions
		nodeOptions: [],
	});
};

export const createGit = async (cwd: string) => {
	const git = (
		command: string,
		args?: string[],
		options?: Options,
	) => (
		execa(
			'git',
			[command, ...(args || [])],
			{
				cwd,
				...options,
			},
		)
	);

	await git(
		'init',
		[
			// In case of different default branch name
			'--initial-branch=master',
		],
	);

	await git('config', ['user.name', 'name']);
	await git('config', ['user.email', 'email']);

	return git;
};

export const createFixture = async (
	source?: string | FileTree,
) => {
	const fixture = await createFixtureBase(source);
	const aicommits = createAicommits(fixture);

	return {
		fixture,
		aicommits,
	};
};

export const files = Object.freeze({
	'.aicommits/config.toml': [
		`api-key = ${JSON.stringify(TEST_PROVIDER_API_KEY)}`,
		`base-url = ${JSON.stringify(TEST_PROVIDER_BASE_URL)}`,
		`model = ${JSON.stringify(TEST_PROVIDER_MODEL)}`,
	].join('\n'),
	'data.json': Array.from({ length: 10 }, (_, i) => `${i}. Lorem ipsum dolor sit amet`).join('\n'),
});

export const liveTestProviderConfig = Object.freeze({
	apiKey: TEST_PROVIDER_API_KEY,
	baseUrl: TEST_PROVIDER_BASE_URL,
	model: TEST_PROVIDER_MODEL,
});

export const hasLiveTestProviderConfig = () => liveTestProviderConfig.apiKey.length > 0;

export const warnSkippedLiveTests = (suiteName: string) => {
	console.warn(
		`⚠️  Skipping ${suiteName} live API tests. Set AICOMMITS_TEST_API_KEY (or OPENAI_API_KEY/OPENAI_KEY) to enable.`,
	);
};

// See ./diffs/README.md in order to generate diff files
export const getDiff = async (diffName: string): Promise<string> => fs.readFile(
	new URL(`fixtures/${diffName}`, import.meta.url),
	'utf8',
);
