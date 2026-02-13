import { cli } from 'cleye';
import { description } from '../package.json';
import aicommits from './commands/aicommits.js';
import prepareCommitMessageHook from './commands/prepare-commit-msg-hook.js';
import configCommand from './commands/config.js';
import hookCommand, { isCalledFromGitHook } from './commands/hook.js';
import { getDisplayVersion } from './utils/version.js';

const displayVersion = getDisplayVersion(import.meta.url);

const rawArgv = process.argv.slice(2);

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
			temperature: {
				type: Number,
				description: 'Sampling temperature for text generation (range: 0 to 2)',
			},
			details: {
				type: Boolean,
				description: 'Generate commit message details/body in addition to the title',
			},
			instructions: {
				type: String,
				description: 'Additional custom prompt instructions (tone, detail level, wording, etc.)',
			},
			conventionalFormat: {
				type: String,
				description: 'Custom conventional commit format template (works with --type conventional)',
			},
			conventionalTypes: {
				type: String,
				description: 'Custom conventional commit type map as JSON (works with --type conventional)',
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
		if (argv.flags.version) {
			console.log(displayVersion);
			process.exit(0);
		}

		if (isCalledFromGitHook) {
			prepareCommitMessageHook();
		} else {
			aicommits(
				argv.flags.generate,
				argv.flags.exclude,
				argv.flags.all,
				argv.flags.type,
				argv.flags.temperature,
				argv.flags.details,
				argv.flags.instructions,
				argv.flags.conventionalFormat,
				argv.flags.conventionalTypes,
				rawArgv,
			);
		}
	},
	rawArgv,
);
