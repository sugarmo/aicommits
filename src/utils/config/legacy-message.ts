import fs from 'fs/promises';
import path from 'path';
import { KnownError } from '../error.js';
import { resolveConfigRelativePath } from './message-files.js';

type RawConfig = Record<string, unknown>;

type ParsedLegacyMessageConfig = {
	locale: string;
	type: '' | 'conventional';
	details: boolean;
	'details-style': 'paragraph' | 'list' | 'markdown';
	instructions: string;
	'conventional-format': string;
	'conventional-types': string;
	'conventional-scope': boolean;
	'title-length-guide': number;
	'detail-column-guide': number;
};

type MessageConfigMigrationOptions = {
	backupConfig?: () => Promise<void>;
	config: RawConfig;
	configDirectoryPath: string;
	normalizeLegacyConfigKeys: (config: RawConfig) => void;
	writeConfig: (config: RawConfig) => Promise<void>;
};

const localeAliases: Record<string, string> = {
	cn: 'zh-CN',
	'zh-cn': 'zh-CN',
	'zh-hans': 'zh-CN',
	zh: 'zh-CN',
	'zh-tw': 'zh-TW',
	'zh-hant': 'zh-TW',
};

const defaultMessageFileName = 'message.md';

export const deprecatedMessageConfigKeys = [
	'locale',
	'type',
	'details',
	'details-style',
	'instructions',
	'conventional-format',
	'conventional-types',
	'conventional-scope',
	'title-length-guide',
	'detail-column-guide',
] as const;

type DeprecatedMessageConfigKey = typeof deprecatedMessageConfigKeys[number];

const deprecatedConfigKeyAliases: Partial<Record<DeprecatedMessageConfigKey, string[]>> = {
	'title-length-guide': ['max-length'],
};

const deprecatedConfigKeySet = new Set<string>([
	...deprecatedMessageConfigKeys,
	'max-length',
]);

const parseAssert = (
	name: string,
	condition: unknown,
	message: string,
) => {
	if (!condition) {
		throw new KnownError(`Invalid config property ${name}: ${message}`);
	}
};

const asRawConfigValue = (value: unknown) => ((
	typeof value === 'string'
	|| typeof value === 'number'
	|| typeof value === 'boolean'
)
	? value
	: undefined);

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
	typeof value === 'object'
	&& value !== null
	&& !Array.isArray(value)
);

const parseBoolean = (
	name: string,
	value: unknown,
	defaultValue: boolean,
) => {
	if (value === undefined || value === null || value === '') {
		return defaultValue;
	}

	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'number') {
		if (value === 1) {
			return true;
		}

		if (value === 0) {
			return false;
		}
	}

	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();

		if (['true', '1', 'yes', 'on'].includes(normalized)) {
			return true;
		}

		if (['false', '0', 'no', 'off'].includes(normalized)) {
			return false;
		}
	}

	throw new KnownError(`Invalid config property ${name}: Must be a boolean (true/false)`);
};

const normalizeLocale = (value: string) => {
	const normalized = value.trim().replace(/_/g, '-');
	const alias = localeAliases[normalized.toLowerCase()];
	return alias ?? normalized;
};

const parseLegacyMessageType = (type?: unknown) => {
	if (!type) {
		return '';
	}

	parseAssert('type', typeof type === 'string', 'Must be a string');
	parseAssert('type', ['', 'conventional'].includes(type as string), 'Invalid commit type');
	return type as '' | 'conventional';
};

const parseLegacyDetailsStyle = (detailsStyle?: unknown) => {
	if (detailsStyle === undefined || detailsStyle === null || detailsStyle === '') {
		return 'paragraph';
	}

	if (typeof detailsStyle !== 'string') {
		throw new KnownError('Invalid config property details-style: Must be a string');
	}

	const normalized = detailsStyle.trim().toLowerCase();
	parseAssert('details-style', ['paragraph', 'list', 'markdown'].includes(normalized), 'Must be one of: paragraph, list, markdown');
	return normalized as 'paragraph' | 'list' | 'markdown';
};

const parseLegacyInstructions = (instructions?: unknown) => {
	if (instructions === undefined || instructions === null) {
		return '';
	}

	if (typeof instructions !== 'string') {
		throw new KnownError('Invalid config property instructions: Must be a string');
	}

	return instructions.trim();
};

const parseLegacyConventionalFormat = (conventionalFormat?: unknown) => {
	if (conventionalFormat === undefined || conventionalFormat === null) {
		return '';
	}

	if (typeof conventionalFormat !== 'string') {
		throw new KnownError('Invalid config property conventional-format: Must be a string');
	}

	return conventionalFormat.trim();
};

const parseLegacyConventionalTypes = (conventionalTypes?: unknown) => {
	if (!conventionalTypes) {
		return '';
	}

	if (typeof conventionalTypes !== 'string') {
		throw new KnownError('Invalid config property conventional-types: Must be valid JSON');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(conventionalTypes);
	} catch {
		throw new KnownError('Invalid config property conventional-types: Must be valid JSON');
	}

	parseAssert(
		'conventional-types',
		typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed),
		'Must be a JSON object with "type":"description" pairs',
	);

	const normalizedEntries = Object.entries(parsed as Record<string, unknown>)
		.map(([key, value]) => [key.trim(), String(value).trim()] as const)
		.filter(([key, value]) => key.length > 0 && value.length > 0);

	parseAssert(
		'conventional-types',
		normalizedEntries.length > 0,
		'Must contain at least one type',
	);

	return JSON.stringify(Object.fromEntries(normalizedEntries));
};

const parseLegacyTitleLengthGuide = (titleLengthGuide?: unknown) => {
	if (!titleLengthGuide) {
		return 50;
	}

	parseAssert('title-length-guide', typeof titleLengthGuide === 'string' || typeof titleLengthGuide === 'number', 'Must be an integer');
	const parsed = Number(titleLengthGuide);
	parseAssert('title-length-guide', Number.isInteger(parsed), 'Must be an integer');
	parseAssert('title-length-guide', parsed >= 20, 'Must be greater than 20 characters');
	return parsed;
};

const parseLegacyDetailColumnGuide = (detailColumnGuide?: unknown) => {
	if (!detailColumnGuide) {
		return 72;
	}

	parseAssert('detail-column-guide', typeof detailColumnGuide === 'string' || typeof detailColumnGuide === 'number', 'Must be an integer');
	const parsed = Number(detailColumnGuide);
	parseAssert('detail-column-guide', Number.isInteger(parsed), 'Must be an integer');
	parseAssert('detail-column-guide', parsed >= 20, 'Must be greater than 20 characters');
	return parsed;
};

const legacyMessageConfigParsers = {
	locale(locale?: unknown) {
		if (!locale) {
			return 'en';
		}

		if (typeof locale !== 'string') {
			throw new KnownError('Invalid config property locale: Must be a string');
		}

		const normalized = normalizeLocale(locale);
		parseAssert(
			'locale',
			/^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(normalized),
			'Must be a valid locale (letters and dashes/underscores). You can consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes',
		);
		return normalized;
	},
	type: parseLegacyMessageType,
	details(details?: unknown) {
		return parseBoolean('details', details, false);
	},
	'details-style': parseLegacyDetailsStyle,
	instructions: parseLegacyInstructions,
	'conventional-format': parseLegacyConventionalFormat,
	'conventional-types': parseLegacyConventionalTypes,
	'conventional-scope'(conventionalScope?: unknown) {
		return parseBoolean('conventional-scope', conventionalScope, false);
	},
	'title-length-guide': parseLegacyTitleLengthGuide,
	'detail-column-guide': parseLegacyDetailColumnGuide,
} as const;

const readDeprecatedScopeValue = (
	scope: RawConfig,
	key: DeprecatedMessageConfigKey,
) => {
	const direct = asRawConfigValue(scope[key]);
	if (direct !== undefined) {
		return direct;
	}

	const aliases = deprecatedConfigKeyAliases[key] || [];
	for (const alias of aliases) {
		const aliasValue = asRawConfigValue(scope[alias]);
		if (aliasValue !== undefined) {
			return aliasValue;
		}
	}

	return undefined;
};

const hasDeprecatedMessageConfig = (scope: RawConfig) => deprecatedMessageConfigKeys.some(
	key => readDeprecatedScopeValue(scope, key) !== undefined,
);

export const resolveLegacyMessageInstructionsMarkdown = (
	config: RawConfig,
	selectedProfile = '',
) => {
	const { profiles } = config;
	if (selectedProfile && isObjectRecord(profiles)) {
		const profileScope = profiles[selectedProfile];
		if (isObjectRecord(profileScope) && hasDeprecatedMessageConfig(profileScope)) {
			return buildLegacyMessageMarkdown(parseLegacyMessageConfig(profileScope));
		}
	}

	if (hasDeprecatedMessageConfig(config)) {
		return buildLegacyMessageMarkdown(parseLegacyMessageConfig(config));
	}

	return undefined;
};

const sanitizeProfileFileSegment = (profileName: string) => {
	const normalized = profileName.trim().replace(/[^\w.-]+/g, '-').replace(/-+/g, '-');
	return normalized.replace(/^-+|-+$/g, '') || 'profile';
};

const buildConventionalSection = (legacyConfig: ParsedLegacyMessageConfig) => {
	if (legacyConfig.type !== 'conventional') {
		return [
			'## Commit Type',
			'- Output a plain commit title, not a conventional commit prefix.',
		].join('\n');
	}

	const lines = [
		'## Commit Type',
		'- Use conventional commit formatting.',
	];

	if (legacyConfig['conventional-scope']) {
		lines.push('- Prefer `type(scope): subject` and only omit scope when there is no clear dominant module, file, class, or subsystem.');
	} else {
		lines.push('- Prefer `type: subject` without a scope.');
	}

	if (legacyConfig['conventional-format']) {
		lines.push(`- Use this title format exactly: \`${legacyConfig['conventional-format']}\`.`);
	}

	if (legacyConfig['conventional-types']) {
		lines.push(
			'- Use these conventional type definitions:',
			'```json',
			legacyConfig['conventional-types'],
			'```',
		);
	}

	return lines.join('\n');
};

const buildBodySection = (legacyConfig: ParsedLegacyMessageConfig) => {
	if (!legacyConfig.details) {
		return [
			'## Body',
			'- Return only the title line with no body.',
		].join('\n');
	}

	const lines = [
		'## Body',
		'- Include a body only when the title alone is not sufficient.',
	];

	if (legacyConfig['details-style'] === 'list') {
		lines.push(
			'- When a body is needed, use concise bullet points.',
			`- Wrap bullet lines around column ${legacyConfig['detail-column-guide']} when practical.`,
		);
	} else if (legacyConfig['details-style'] === 'markdown') {
		lines.push('- When a body is needed, use concise markdown without fenced code blocks.');
	} else {
		lines.push(
			'- When a body is needed, write concise prose paragraphs.',
			`- Wrap body text around column ${legacyConfig['detail-column-guide']} when practical.`,
		);
	}

	return lines.join('\n');
};

const buildLegacyMessageMarkdown = (legacyConfig: ParsedLegacyMessageConfig) => [
	'# Commit Message Instructions',
	'',
	'## Language',
	`- Write the commit message strictly in ${legacyConfig.locale}.`,
	'',
	buildConventionalSection(legacyConfig),
	'',
	'## Title',
	'- Use concise imperative wording.',
	'- Focus on the dominant user-facing, product-facing, or operational outcome first.',
	'- Prefer the end result over the implementation mechanism.',
	`- Keep the title around ${legacyConfig['title-length-guide']} characters when practical.`,
	'',
	buildBodySection(legacyConfig),
	'',
	'## Style',
	'- Describe what the change enables, fixes, prevents, or improves.',
	'- Avoid vague subjects like "update", "improve", "refactor", or "cleanup" unless the diff is genuinely dominated by maintenance work.',
	...(legacyConfig.instructions
		? [
			'',
			'## Additional Instructions',
			legacyConfig.instructions,
		]
		: []),
].join('\n');

const ensureParentDirectory = async (targetPath: string) => {
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
};

const ensureRegularFileExists = async (
	targetPath: string,
	description: string,
) => {
	let stats;
	try {
		stats = await fs.lstat(targetPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new KnownError(`${description} was not created: ${targetPath}`);
		}

		throw error;
	}

	if (!stats.isFile()) {
		throw new KnownError(`${description} must point to a file: ${targetPath}`);
	}
};

const writeFileIfMissing = async (
	targetPath: string,
	content: string,
) => {
	try {
		const stats = await fs.lstat(targetPath);
		if (!stats.isFile()) {
			throw new KnownError(`Migrated message Markdown file must point to a file: ${targetPath}`);
		}

		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}

	await ensureParentDirectory(targetPath);
	await fs.writeFile(targetPath, `${content.trimEnd()}\n`, 'utf8');
	await ensureRegularFileExists(targetPath, 'Migrated message Markdown file');
};

const parseLegacyMessageConfig = (scope: RawConfig): ParsedLegacyMessageConfig => ({
	locale: legacyMessageConfigParsers.locale(readDeprecatedScopeValue(scope, 'locale')),
	type: legacyMessageConfigParsers.type(readDeprecatedScopeValue(scope, 'type')),
	details: legacyMessageConfigParsers.details(readDeprecatedScopeValue(scope, 'details')),
	'details-style': legacyMessageConfigParsers['details-style'](readDeprecatedScopeValue(scope, 'details-style')),
	instructions: legacyMessageConfigParsers.instructions(readDeprecatedScopeValue(scope, 'instructions')),
	'conventional-format': legacyMessageConfigParsers['conventional-format'](readDeprecatedScopeValue(scope, 'conventional-format')),
	'conventional-types': legacyMessageConfigParsers['conventional-types'](readDeprecatedScopeValue(scope, 'conventional-types')),
	'conventional-scope': legacyMessageConfigParsers['conventional-scope'](readDeprecatedScopeValue(scope, 'conventional-scope')),
	'title-length-guide': legacyMessageConfigParsers['title-length-guide'](readDeprecatedScopeValue(scope, 'title-length-guide')),
	'detail-column-guide': legacyMessageConfigParsers['detail-column-guide'](readDeprecatedScopeValue(scope, 'detail-column-guide')),
});

const removeDeprecatedMessageKeys = (scope: RawConfig) => {
	for (const key of deprecatedMessageConfigKeys) {
		delete scope[key];
		const aliases = deprecatedConfigKeyAliases[key] || [];
		for (const alias of aliases) {
			delete scope[alias];
		}
	}
};

const migrateLegacyMessageScope = async (
	scope: RawConfig,
	configDirectoryPath: string,
	defaultMessagePathRaw: string,
	assignMessagePath: boolean,
) => {
	if (!hasDeprecatedMessageConfig(scope)) {
		return false;
	}

	const legacyConfig = parseLegacyMessageConfig(scope);
	const configuredMessagePath = asRawConfigValue(scope['message-path']);
	const nextMessagePath = (
		typeof configuredMessagePath === 'string' && configuredMessagePath.trim()
			? configuredMessagePath.trim()
			: defaultMessagePathRaw
	);
	const resolvedMessagePath = resolveConfigRelativePath(
		configDirectoryPath,
		nextMessagePath,
		defaultMessagePathRaw,
	);

	await writeFileIfMissing(
		resolvedMessagePath,
		buildLegacyMessageMarkdown(legacyConfig),
	);

	if (assignMessagePath) {
		scope['message-path'] = nextMessagePath;
	}

	removeDeprecatedMessageKeys(scope);
	return true;
};

export const migrateLegacyMessageConfig = async ({
	backupConfig,
	config,
	configDirectoryPath,
	normalizeLegacyConfigKeys,
	writeConfig,
}: MessageConfigMigrationOptions) => {
	let changed = false;

	changed = await migrateLegacyMessageScope(
		config,
		configDirectoryPath,
		defaultMessageFileName,
		false,
	) || changed;

	const { profiles } = config;
	if (isObjectRecord(profiles)) {
		for (const [profileName, profileValue] of Object.entries(profiles)) {
			if (!isObjectRecord(profileValue)) {
				continue;
			}

			const profileDefaultPath = `message.${sanitizeProfileFileSegment(profileName)}.md`;
			changed = await migrateLegacyMessageScope(
				profileValue,
				configDirectoryPath,
				profileDefaultPath,
				true,
			) || changed;
		}
	}

	if (!changed) {
		return;
	}

	normalizeLegacyConfigKeys(config);
	await backupConfig?.();
	await writeConfig(config);
};

export const getDeprecatedConfigError = (key: string) => {
	const normalized = key.trim();
	if (!deprecatedConfigKeySet.has(normalized)) {
		return undefined;
	}

	return `Config property "${normalized}" has moved to your message Markdown file. Edit ~/.aicommits/message.md or set message-path instead.`;
};
