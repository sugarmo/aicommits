import { testSuite, expect } from 'manten';
import { generatePrompt } from '../../src/utils/prompt.js';

export default testSuite(({ describe, test }) => {
	describe('prompt', () => {
		test('generates title-only prompt by default', () => {
			const prompt = generatePrompt('en', 50, '');

			expect(prompt).toMatch('Provide only the title, no description or body.');
			expect(prompt).toMatch('Commit title must be a maximum of 50 characters.');
		});

		test('supports details and custom conventional instructions', () => {
			const prompt = generatePrompt('en', 72, 'conventional', {
				includeDetails: true,
				instructions: 'Use a friendly but direct tone.',
				conventionalFormat: '<type>(<scope>): <subject>',
				conventionalTypes: '{"feature":"Introduce a new capability","bugfix":"Fix a defect"}',
			});

			expect(prompt).toMatch('If the title is already sufficient, output only the title.');
			expect(prompt).toMatch('Do not add any explanation for omitting the body.');
			expect(prompt).toMatch('<type>(<scope>): <subject>');
			expect(prompt).toMatch('"feature": "Introduce a new capability"');
			expect(prompt).toMatch('Additional instructions from user:');
		});

		test('locks conventional type when provided', () => {
			const prompt = generatePrompt('en', 72, 'conventional', {
				lockedConventionalType: 'refactor',
			});

			expect(prompt).toMatch('Selected conventional type (locked): refactor');
			expect(prompt).toMatch('Use this exact type in the title prefix.');
			expect(prompt).not.toMatch('Type selection workflow (must run internally before writing the final title)');
		});

		test('uses github-copilot style by default', () => {
			const prompt = generatePrompt('en', 72, 'conventional', {
				includeDetails: true,
			});

			expect(prompt).toMatch('Use GitHub Copilot style.');
			expect(prompt).toMatch('Conventional title subject rules:');
			expect(prompt).toMatch('Example to avoid: "refactor: refactor ..."');
			expect(prompt).toMatch('The body should be 3-6 concise technical prose sentences');
			expect(prompt).toMatch('Do not use section labels like "Impact:"');
		});

		test('does not include score-based type selection workflow', () => {
			const prompt = generatePrompt('en', 72, 'conventional');

			expect(prompt).not.toMatch('Type selection workflow');
			expect(prompt).not.toMatch('EvidenceMatch');
			expect(prompt).not.toMatch('WeightedScore');
		});

		test('supports list detail style', () => {
			const prompt = generatePrompt('en', 72, 'conventional', {
				includeDetails: true,
				detailsStyle: 'list',
			});

			expect(prompt).toMatch('The body must be 3-6 concise bullet points.');
			expect(prompt).toMatch('Each bullet must start with "- ".');
		});

		test('injects changed files and anchor requirement', () => {
			const prompt = generatePrompt('en', 72, 'conventional', {
				changedFiles: [
					'Extensions/RecentScrollshot/Source/RecentScrollshotController.swift',
					'Extensions/RecentScrollshot/Source/RecentScrollshotStore.swift',
				],
			});

			expect(prompt).toMatch('Changed files:');
			expect(prompt).toMatch('RecentScrollshotController.swift');
			expect(prompt).toMatch('Title anchor requirement:');
			expect(prompt).toMatch('must mention at least one concrete anchor');
			expect(prompt).toMatch('Do not include scope in conventional titles.');
			expect(prompt).toMatch('Use "<type>: <subject>" format instead of "<type>(<scope>): <subject>".');
		});

		test('uses global summary style by default', () => {
			const prompt = generatePrompt('en', 72, '', {
				includeDetails: true,
				detailsStyle: 'list',
				changedFiles: [
					'src/core/engine.ts',
					'src/core/pipeline.ts',
				],
			});

			expect(prompt).toMatch('initiative/subsystem level');
			expect(prompt).toMatch('avoid per-file or per-function enumeration');
			expect(prompt).toMatch('prefer 2-4 theme-level bullets');
			expect(prompt).not.toMatch('Large change-set mode:');
		});

		test('switches to high-level summary mode for very large change sets', () => {
			const prompt = generatePrompt('en', 72, 'conventional', {
				includeDetails: true,
				detailsStyle: 'list',
				changedFiles: Array.from(
					{ length: 14 },
					(_, index) => `src/modules/mod-${index}.ts`,
				),
			});

			expect(prompt).toMatch('Large change-set mode:');
			expect(prompt).toMatch('overall intent coverage');
			expect(prompt).toMatch('Do not try to list every module/class/file touched.');
			expect(prompt).toMatch('use 2-4 high-level bullets grouped by themes');
		});

		test('enables high-level summary mode when diff was compacted', () => {
			const prompt = generatePrompt('en', 72, '', {
				diffWasCompacted: true,
			});

			expect(prompt).toMatch('Large change-set mode:');
		});

		test('supports enabling conventional scope emphasis', () => {
			const prompt = generatePrompt('en', 72, 'conventional', {
				conventionalScope: true,
			});

			expect(prompt).toMatch('include scope using the primary file/class/module');
			expect(prompt).toMatch('Only omit scope when there is no clear dominant anchor.');
			expect(prompt).toMatch('<type>[optional (<scope>)]: <commit message>');
		});

		test('enforces message language strictly', () => {
			const prompt = generatePrompt('zh-CN', 72, '');

			expect(prompt).toMatch('Message language: zh-CN');
			expect(prompt).toMatch('must write the commit message strictly in this language');
		});
	});
});
