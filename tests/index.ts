import { describe } from 'manten';

describe('aicommits', ({ runTestSuite }) => {
	runTestSuite(import('./specs/cli/index.js'));
	runTestSuite(import('./specs/openai/index.js'));
	runTestSuite(import('./specs/config.js'));
	runTestSuite(import('./specs/prompt.js'));
	runTestSuite(import('./specs/diff-compaction.js'));
	runTestSuite(import('./specs/detail-column-guide.js'));
	runTestSuite(import('./specs/commit-message-prompt.js'));
	runTestSuite(import('./specs/reasoning-content.js'));
	runTestSuite(import('./specs/reasoning-effort.js'));
	runTestSuite(import('./specs/rewrite-feedback.js'));
	runTestSuite(import('./specs/git.js'));
	runTestSuite(import('./specs/git-hook.js'));
	runTestSuite(import('./specs/hook-compat.js'));
});
