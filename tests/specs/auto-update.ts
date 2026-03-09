import { testSuite, expect } from 'manten';
import { checkAndAutoUpdate } from '../../src/utils/auto-update.js';

export default testSuite(({ describe }) => {
	describe('Auto update', ({ test }) => {
		test('skips update checks entirely in headless mode', async () => {
			const originalFetch = globalThis.fetch;
			const originalConsoleLog = console.log;
			const fetchCalls: string[] = [];
			const consoleCalls: string[] = [];

			globalThis.fetch = (async (input: string | URL | Request) => {
				fetchCalls.push(String(input));
				throw new Error('fetch should not be called in headless mode');
			}) as typeof fetch;

			console.log = (...args: unknown[]) => {
				consoleCalls.push(args.join(' '));
			};

			try {
				await checkAndAutoUpdate({
					pkg: {
						name: 'aicommits',
						version: '1.0.0',
					},
					headless: true,
				});
			} finally {
				globalThis.fetch = originalFetch;
				console.log = originalConsoleLog;
			}

			expect(fetchCalls).toEqual([]);
			expect(consoleCalls).toEqual([]);
		});
	});
});
