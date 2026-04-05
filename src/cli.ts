import { cli } from 'cleye';
import { description } from '../package.json';
import aicommits from './commands/aicommits.js';
import prepareCommitMessageHook from './commands/prepare-commit-msg-hook.js';
import configCommand from './commands/config.js';
import hookCommand, { isCalledFromGitHook } from './commands/hook.js';
import { getDisplayVersion } from './utils/version.js';
import { getDeprecatedFlagError } from './utils/config.js';
import { KnownError } from './utils/error.js';

const displayVersion = getDisplayVersion(import.meta.url);

const rawArgv = process.argv.slice(2);
const isCalledFromHookCommand = rawArgv[0] === 'prepare-commit-msg-hook';
const deprecatedFlags = [
	{
		flag: '--type',
		matches: ['--type', '-t'],
	},
	{
		flag: '--details',
		matches: ['--details'],
	},
	{
		flag: '--details-style',
		matches: ['--details-style'],
	},
	{
		flag: '--instructions',
		matches: ['--instructions'],
	},
	{
		flag: '--conventional-format',
		matches: ['--conventional-format'],
	},
	{
		flag: '--conventional-types',
		matches: ['--conventional-types'],
	},
	{
		flag: '--conventional-scope',
		matches: ['--conventional-scope'],
	},
];

cli(
	{
		name: 'aicommits',

		/**
		 * Since this is a wrapper around `git commit`,
		 * flags should not overlap with it
		 * https://git-scm.com/docs/git-commit
		 */
		flags: {
			generate: {
				type: Number,
				description: 'Number of messages to generate (Warning: generating multiple costs more) (default: 1)',
				alias: 'g',
			},
			exclude: {
				type: [String],
				description: 'Files to exclude from AI analysis',
				alias: 'x',
			},
			all: {
				type: Boolean,
				description: 'Automatically stage changes in tracked files for the commit',
				alias: 'a',
				default: false,
			},
			type: {
				type: String,
				description: 'Git commit message format (default: plain). Supports conventional',
				alias: 't',
			},
			details: {
				type: Boolean,
				description: 'Generate commit message details/body in addition to the title',
			},
			showReasoning: {
				type: Boolean,
				description: 'Stream and print model reasoning while generating messages',
			},
			reasoningEffort: {
				type: String,
				description: 'Reasoning effort to request: none, low, medium, high, or xhigh',
			},
			apiMode: {
				type: String,
				description: 'API mode to use: responses (default) or chat',
			},
			messageFile: {
				type: String,
				description: 'Markdown file used to guide commit message generation',
			},
			postResponseScript: {
				type: String,
				description: 'Executable script that can rewrite the AI response via stdin/stdout',
			},
			baseUrl: {
				type: String,
				description: 'API base URL for Responses API (default) or Chat Completions (for example https://api.openai.com/v1)',
			},
			confirm: {
				type: Boolean,
				description: 'Skip interactive confirmation/selection prompts and use the first generated message',
				alias: 'y',
				default: false,
			},
			yes: {
				type: Boolean,
				description: 'Alias for --confirm',
				default: false,
			},
			version: {
				type: Boolean,
				description: 'Show version number',
				alias: 'v',
			},
		},

		commands: [
			configCommand,
			hookCommand,
		],

		help: {
			description,
		},

		ignoreArgv: type => type === 'unknown-flag' || type === 'argument',
	},
	(argv) => {
		for (const { flag, matches } of deprecatedFlags) {
			if (rawArgv.some(argument => matches.some(match => argument === match || argument.startsWith(`${match}=`)))) {
				throw new KnownError(getDeprecatedFlagError(flag));
			}
		}

		if (argv.flags.version) {
			console.log(displayVersion);
			process.exit(0);
		}

		if (isCalledFromGitHook || isCalledFromHookCommand) {
			prepareCommitMessageHook();
		} else {
			aicommits(
				argv.flags.generate,
				argv.flags.exclude,
				argv.flags.all,
				argv.flags.showReasoning,
				argv.flags.reasoningEffort,
				argv.flags.apiMode,
				argv.flags.messageFile,
				argv.flags.postResponseScript,
				argv.flags.baseUrl,
				argv.flags.confirm || argv.flags.yes,
				rawArgv,
			);
		}
	},
	rawArgv,
);
