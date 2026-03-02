import { describe } from 'manten';

describe('aicommits', ({ runTestSuite }) => {
	runTestSuite(import('./specs/cli/index.js'));
	runTestSuite(import('./specs/openai/index.js'));
	runTestSuite(import('./specs/config.js'));
	runTestSuite(import('./specs/prompt.js'));
	runTestSuite(import('./specs/diff-compaction.js'));
	runTestSuite(import('./specs/conventional-scope.js'));
	runTestSuite(import('./specs/git.js'));
	runTestSuite(import('./specs/git-hook.js'));
	runTestSuite(import('./specs/hook-compat.js'));
});
