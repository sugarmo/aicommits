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

const conventionalInstructions = [
	'# Commit Message Instructions',
	'',
	'## Language',
	'- Write the commit message in English.',
	'',
	'## Format',
	'- Use conventional commit formatting.',
	'- Prefer `type(scope): subject` when there is a clear dominant anchor.',
	'- Return only the title line with no body.',
	'',
	'## Style',
	'- Use concise imperative wording.',
	'- Focus on the dominant outcome first.',
].join('\n');

const runGenerateCommitMessage = async (
	gitDiff: string,
) => {
	const commitMessages = await generateCommitMessage(
		liveTestProviderConfig.apiKey,
		liveTestProviderConfig.model,
		gitDiff,
		1,
		7000,
		undefined,
		{
			messageInstructionsMarkdown: conventionalInstructions,
		},
		liveTestProviderConfig.baseUrl,
	);

	return commitMessages[0];
};

export default testSuite(({ describe }) => {
	if (!hasLiveTestProviderConfig()) {
		warnSkippedLiveTests('OpenAI-compatible commit generation');
		return;
	}

	describe('Markdown-guided commit generation', async ({ test }) => {
		await test('respects conventional instructions across representative diffs', async () => {
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
	});
});
