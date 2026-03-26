import { expect, testSuite } from 'manten';
import { resolveRequestOptionsForApi } from '../../src/utils/openai.js';

export default testSuite(({ describe, test }) => {
	describe('reasoning effort request mapping', () => {
		test('applies explicit reasoning-effort to Responses API requests', () => {
			const requestOptions = resolveRequestOptionsForApi(
				'{"thinking":{"type":"disabled"}}',
				'responses',
				'high',
			);

			expect(requestOptions).toEqual({
				thinking: { type: 'disabled' },
				reasoning: { effort: 'high' },
			});
		});

		test('preserves backward-compatible Responses reasoning object fields', () => {
			const requestOptions = resolveRequestOptionsForApi(
				'{"reasoning":{"summary":"auto"}}',
				'responses',
				'low',
			);

			expect(requestOptions).toEqual({
				reasoning: {
					summary: 'auto',
					effort: 'low',
				},
			});
		});

		test('maps explicit reasoning-effort to Chat requests', () => {
			const requestOptions = resolveRequestOptionsForApi(
				'{"temperature":0.2}',
				'chat',
				'medium',
			);

			expect(requestOptions).toEqual({
				temperature: 0.2,
				reasoning_effort: 'medium',
			});
		});

		test('keeps legacy request-options reasoning compatibility when explicit reasoning-effort is unset', () => {
			const requestOptions = resolveRequestOptionsForApi(
				'{"reasoning_effort":"high"}',
				'responses',
			);

			expect(requestOptions).toEqual({
				reasoning: { effort: 'high' },
			});
		});
	});
});
