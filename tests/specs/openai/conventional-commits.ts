import { expect, testSuite } from 'manten';
import {
	generateCommitMessage,
} from '../../../src/utils/openai.js';
import {
	getDiff,
	hasLiveTestProviderConfig,
	liveTestProviderConfig,
	warnSkippedLiveTests,
} from '../../utils.js';

const conventionalTitlePattern = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]+\))?:\s+\S/;
const conventionalTitleWithoutScopePattern = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test):\s+\S/;

type RunGenerateOptions = {
	conventionalScope?: boolean;
	locale?: string;
	maxLength?: number;
};

const runGenerateCommitMessage = async (
	gitDiff: string,
	options: RunGenerateOptions = {},
) => {
	const commitMessages = await generateCommitMessage(
		liveTestProviderConfig.apiKey,
		liveTestProviderConfig.model,
		options.locale ?? 'en',
		gitDiff,
		1,
		options.maxLength ?? 50,
		'conventional',
		7000,
		undefined,
		{
			conventionalScope: options.conventionalScope,
		},
		liveTestProviderConfig.baseUrl,
	);

	return commitMessages[0];
};

export default testSuite(({ describe }) => {
	if (!hasLiveTestProviderConfig()) {
		warnSkippedLiveTests('OpenAI-compatible conventional commit generation');
		return;
	}

	describe('Conventional Commits', async ({ test }) => {
		await test('generates valid conventional titles across representative diffs', async () => {
			for (const diffName of [
				'new-feature.diff',
				'code-refactoring.diff',
				'documentation-changes.diff',
			]) {
				const gitDiff = await getDiff(diffName);
				const commitMessage = await runGenerateCommitMessage(gitDiff);

				expect(commitMessage).toMatch(conventionalTitlePattern);
				console.log(`[${diffName}] Generated message:`, commitMessage);
			}
		});

		await test('keeps conventional format stable with Japanese locale setting', async () => {
			const gitDiff = await getDiff('new-feature.diff');
			const commitMessage = await runGenerateCommitMessage(gitDiff, {
				locale: 'ja',
			});

			expect(commitMessage).toMatch(conventionalTitlePattern);
			console.log('Generated message:', commitMessage);
		});

		await test('supports disabling conventional scope in title', async () => {
			const gitDiff = await getDiff('new-feature.diff');
			const commitMessage = await runGenerateCommitMessage(gitDiff, {
				conventionalScope: false,
			});

			expect(commitMessage).toMatch(conventionalTitleWithoutScopePattern);
			console.log('Generated message:', commitMessage);
		});
	});
});
