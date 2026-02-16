import { testSuite } from 'manten';

export default testSuite(({ describe }) => {
	describe('OpenAI-compatible providers', ({ runTestSuite }) => {
		runTestSuite(import('./conventional-commits.js'));
	});
});
