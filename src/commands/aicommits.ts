import { execa } from 'execa';
import {
	black, dim, green, red, bgCyan,
} from 'kolorist';
import {
	intro, outro, spinner, select, confirm, isCancel,
} from '@clack/prompts';
import {
	assertGitRepo,
	getStagedDiff,
	getDetectedMessage,
} from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import {
	generateCommitMessage,
	type ConventionalTypeJudgeReport,
	type ConventionalTypeScoreCandidate,
} from '../utils/openai.js';
import { KnownError, handleCliError } from '../utils/error.js';

const formatScore = (score: number, digits: number) => score.toFixed(digits);

const formatPrefixScoreLine = (
	candidate: ConventionalTypeScoreCandidate,
	index: number,
) => {
	const gateLabel = candidate.modelHardGatePass === candidate.hardGatePass
		? (candidate.hardGatePass ? 'pass' : 'fail')
		: `${candidate.hardGatePass ? 'pass' : 'fail'}(model=${candidate.modelHardGatePass ? 'pass' : 'fail'})`;

	return (
	`${index + 1}. ${candidate.typeName}`
	+ ` weighted=${formatScore(candidate.weightedScore, 2)}`
	+ ` (E=${formatScore(candidate.evidenceMatch, 1)}`
	+ ` C=${formatScore(candidate.titleBodyConsistency, 1)}`
	+ ` X=${formatScore(candidate.exclusivity, 1)}`
	+ ` w=${formatScore(candidate.typeWeight, 2)}`
	+ ` gate=${gateLabel})`
	);
};

const printPrefixScores = (report: ConventionalTypeJudgeReport) => {
	const topCandidates = report.topCandidates;

	console.log(dim(`     Prefix scoring source: ${report.source}`));

	if (topCandidates.length === 0) {
		console.log(dim('     Prefix scoring returned no valid candidates.'));
		console.log(dim('     Locked type: none'));
		return;
	}

	for (const [index, candidate] of topCandidates.entries()) {
		console.log(dim(`     ${formatPrefixScoreLine(candidate, index)}`));
	}

	console.log(dim(`     Locked type: ${report.selectedType || 'none'}`));
};

export default async (
	generate: number | undefined,
	excludeFiles: string[],
	stageAll: boolean,
	commitType: string | undefined,
	temperature: number | undefined,
	includeDetails: boolean | undefined,
	customInstructions: string | undefined,
	conventionalFormat: string | undefined,
	conventionalTypes: string | undefined,
	rawArgv: string[],
) => (async () => {
	intro(bgCyan(black(' aicommits ')));
	await assertGitRepo();

	const detectingFiles = spinner();

	if (stageAll) {
		// This should be equivalent behavior to `git commit --all`
		await execa('git', ['add', '--update']);
	}

	detectingFiles.start('Detecting staged files');
	const staged = await getStagedDiff(excludeFiles);

	if (!staged) {
		detectingFiles.stop('Detecting staged files');
		throw new KnownError('No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.');
	}

	detectingFiles.stop(`${getDetectedMessage(staged.files)}:\n${staged.files.map(file => `     ${file}`).join('\n')
		}`);

	const { env } = process;
	const config = await getConfig({
		OPENAI_KEY: env.OPENAI_KEY || env.OPENAI_API_KEY,
		proxy: env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY,
		generate: generate?.toString(),
		type: commitType?.toString(),
		temperature: temperature === undefined ? undefined : temperature.toString(),
		details: includeDetails === true ? 'true' : undefined,
		instructions: customInstructions,
		'conventional-format': conventionalFormat,
		'conventional-types': conventionalTypes,
	});

	const promptOptions = {
		includeDetails: config.details,
		instructions: config.instructions,
		conventionalFormat: config['conventional-format'],
		conventionalTypes: config['conventional-types'],
		changedFiles: staged.files,
	};

	const s = spinner();
	s.start('The AI is analyzing your changes');
	let messages: string[];
	let changedToGenerationStage = false;
	try {
		messages = await generateCommitMessage(
			config.OPENAI_KEY,
			config.model,
			config.locale,
			staged.diff,
			config.generate,
			config['max-length'],
			config.type,
			config.timeout,
			config.proxy,
			{
				...promptOptions,
				onConventionalTypeScored: (report) => {
					const summary = report.topCandidates
						.map((item) => {
							const gateMismatch = item.modelHardGatePass !== item.hardGatePass;
							const gateFlag = item.hardGatePass ? '' : '(gate-fail)';
							return `${item.typeName}=${formatScore(item.weightedScore, 2)}${gateMismatch ? '(gate-adjusted)' : gateFlag}`;
						})
						.join(', ');

					s.stop(summary ? `Prefix scoring complete: ${summary}` : 'Prefix scoring complete');
					printPrefixScores(report);
					s.start('The AI is generating your commit message');
					changedToGenerationStage = true;
				},
			},
			config.temperature,
		);
	} finally {
		s.stop(changedToGenerationStage ? 'Commit messages generated' : 'Changes analyzed');
	}

	if (messages.length === 0) {
		throw new KnownError('No commit messages were generated. Try again.');
	}

	let message: string;
	if (messages.length === 1) {
		[message] = messages;
		const confirmed = await confirm({
			message: `Use this commit message?\n\n   ${message}\n`,
		});

		if (!confirmed || isCancel(confirmed)) {
			outro('Commit cancelled');
			return;
		}
	} else {
		const selected = await select({
			message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
			options: messages.map(value => ({ label: value, value })),
		});

		if (isCancel(selected)) {
			outro('Commit cancelled');
			return;
		}

		message = selected as string;
	}

	await execa('git', ['commit', '-m', message, ...rawArgv]);

	outro(`${green('✔')} Successfully committed!`);
})().catch((error) => {
	outro(`${red('✖')} ${error.message}`);
	handleCliError(error);
	process.exit(1);
});
