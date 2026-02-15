import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { TiktokenModel } from '@dqbd/tiktoken';
import { KnownError } from './error.js';

const commitTypes = ['', 'conventional'] as const;

export type CommitType = typeof commitTypes[number];

const { hasOwnProperty } = Object.prototype;
export const hasOwn = (object: unknown, key: PropertyKey) => hasOwnProperty.call(object, key);

const parseAssert = (
	name: string,
	condition: any,
	message: string,
) => {
	if (!condition) {
		throw new KnownError(`Invalid config property ${name}: ${message}`);
	}
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
	typeof value === 'object'
	&& value !== null
	&& !Array.isArray(value)
);

const asRawConfigValue = (value: unknown) => (
	typeof value === 'string'
	|| typeof value === 'number'
	|| typeof value === 'boolean'
)
	? value
	: undefined;

const localeAliases: Record<string, string> = {
	cn: 'zh-CN',
	'zh-cn': 'zh-CN',
	'zh-hans': 'zh-CN',
	zh: 'zh-CN',
	'zh-tw': 'zh-TW',
	'zh-hant': 'zh-TW',
};

const normalizeLocale = (value: string) => {
	const normalized = value.trim().replace(/_/g, '-');
	const alias = localeAliases[normalized.toLowerCase()];
	return alias ?? normalized;
};

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

const parseConventionalTypes = (rawConventionalTypes: string) => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawConventionalTypes);
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

const configParsers = {
	'api-key'(key?: unknown) {
		if (!key) {
			throw new KnownError('Please set your API key via `aicommits config set api-key=<your token>`');
		}
		if (typeof key !== 'string') {
			throw new KnownError('Invalid config property api-key: Must be a string');
		}

		const normalized = key.trim();
		parseAssert('api-key', normalized.length > 0, 'Cannot be empty');
		return normalized;
	},
	'base-url'(baseUrl?: unknown) {
		if (baseUrl === undefined || baseUrl === null || baseUrl === '') {
			throw new KnownError('Please set your API base URL via `aicommits config set base-url=<https://...>`');
		}

		if (typeof baseUrl !== 'string') {
			throw new KnownError('Invalid config property base-url: Must be a valid URL');
		}

		const normalized = baseUrl.trim();
		let parsed: URL;
		try {
			parsed = new URL(normalized);
		} catch {
			throw new KnownError('Invalid config property base-url: Must be a valid URL');
		}

		parseAssert('base-url', parsed.protocol === 'https:', 'Must be an HTTPS URL');
		parseAssert('base-url', parsed.hash === '', 'Must not include URL fragments');
		parseAssert('base-url', parsed.search === '', 'Must not include query parameters');

		const pathname = parsed.pathname.replace(/\/+$/, '');
		return `${parsed.origin}${pathname}`;
	},
	profile(profile?: unknown) {
		if (profile === undefined || profile === null) {
			return '';
		}

		if (typeof profile !== 'string') {
			throw new KnownError('Invalid config property profile: Must be a string');
		}

		return profile.trim();
	},
	locale(locale?: unknown) {
		if (!locale) {
			return 'en';
		}

		if (typeof locale !== 'string') {
			throw new KnownError('Invalid config property locale: Must be a string');
		}

		const normalized = normalizeLocale(locale);
		parseAssert('locale', normalized.length > 0, 'Cannot be empty');
		parseAssert(
			'locale',
			/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(normalized),
			'Must be a valid locale (letters and dashes/underscores). You can consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes',
		);
		return normalized;
	},
	generate(count?: unknown) {
		if (!count) {
			return 1;
		}

		parseAssert('generate', typeof count === 'string' || typeof count === 'number', 'Must be an integer');

		const parsed = Number(count);
		parseAssert('generate', Number.isInteger(parsed), 'Must be an integer');
		parseAssert('generate', parsed > 0, 'Must be greater than 0');
		parseAssert('generate', parsed <= 5, 'Must be less or equal to 5');

		return parsed;
	},
	type(type?: unknown) {
		if (!type) {
			return '';
		}

		parseAssert('type', typeof type === 'string', 'Must be a string');
		parseAssert('type', commitTypes.includes(type as CommitType), 'Invalid commit type');

		return type as CommitType;
	},
	proxy(url?: unknown) {
		if (url === undefined || url === null || url === '') {
			return undefined;
		}

		if (typeof url !== 'string') {
			throw new KnownError('Invalid config property proxy: Must be a valid URL');
		}
		parseAssert('proxy', /^https?:\/\//.test(url), 'Must be a valid URL');

		return url;
	},
	model(model?: unknown) {
		if (model === undefined || model === null || model === '') {
			return 'gpt-3.5-turbo';
		}

		if (typeof model !== 'string') {
			throw new KnownError('Invalid config property model: Must be a string');
		}

		return model as TiktokenModel;
	},
	timeout(timeout?: unknown) {
		if (!timeout) {
			return 10_000;
		}

		parseAssert('timeout', typeof timeout === 'string' || typeof timeout === 'number', 'Must be an integer');

		const parsed = Number(timeout);
		parseAssert('timeout', Number.isInteger(parsed), 'Must be an integer');
		parseAssert('timeout', parsed >= 500, 'Must be greater than 500ms');

		return parsed;
	},
	'max-length'(maxLength?: unknown) {
		if (!maxLength) {
			return 50;
		}

		parseAssert('max-length', typeof maxLength === 'string' || typeof maxLength === 'number', 'Must be an integer');

		const parsed = Number(maxLength);
		parseAssert('max-length', Number.isInteger(parsed), 'Must be an integer');
		parseAssert('max-length', parsed >= 20, 'Must be greater than 20 characters');

		return parsed;
	},
	details(details?: unknown) {
		return parseBoolean('details', details, false);
	},
	'show-reasoning'(showReasoning?: unknown) {
		return parseBoolean('show-reasoning', showReasoning, false);
	},
	'details-style'(detailsStyle?: unknown) {
		if (detailsStyle === undefined || detailsStyle === null || detailsStyle === '') {
			return 'paragraph';
		}

		if (typeof detailsStyle !== 'string') {
			throw new KnownError('Invalid config property details-style: Must be a string');
		}
		const normalized = detailsStyle.trim().toLowerCase();
		parseAssert('details-style', ['paragraph', 'list'].includes(normalized), 'Must be one of: paragraph, list');
		return normalized as 'paragraph' | 'list';
	},
	instructions(instructions?: unknown) {
		if (instructions === undefined || instructions === null) {
			return '';
		}

		if (typeof instructions !== 'string') {
			throw new KnownError('Invalid config property instructions: Must be a string');
		}
		return instructions.trim();
	},
	'conventional-format'(conventionalFormat?: unknown) {
		if (conventionalFormat === undefined || conventionalFormat === null) {
			return '';
		}

		if (typeof conventionalFormat !== 'string') {
			throw new KnownError('Invalid config property conventional-format: Must be a string');
		}
		return conventionalFormat.trim();
	},
	'conventional-types'(conventionalTypes?: unknown) {
		if (!conventionalTypes) {
			return '';
		}

		if (typeof conventionalTypes !== 'string') {
			throw new KnownError('Invalid config property conventional-types: Must be valid JSON');
		}
		return parseConventionalTypes(conventionalTypes);
	},
	'conventional-scope'(conventionalScope?: unknown) {
		return parseBoolean('conventional-scope', conventionalScope, true);
	},
} as const;

type ConfigKeys = keyof typeof configParsers;
type RawConfigValue = string | number | boolean;
type CliConfig = Partial<Record<ConfigKeys, RawConfigValue>>;

type RawConfig = Record<string, unknown>;

export type ValidConfig = {
	[Key in ConfigKeys]: ReturnType<typeof configParsers[Key]>;
};

const legacyConfigAliases: Partial<Record<ConfigKeys, string[]>> = {
	'api-key': ['openai-key', 'OPENAI_KEY', 'OPENAI_API_KEY'],
	'base-url': ['openai-base-url', 'OPENAI_BASE_URL'],
	model: ['OPENAI_MODEL'],
};

const configDirectoryPath = path.join(os.homedir(), '.aicommits');
const configPath = path.join(configDirectoryPath, 'config.toml');
const legacyConfigPaths = [
	path.join(os.homedir(), 'aicommits.toml'),
	path.join(os.homedir(), '.aicommits'),
];

const stripTomlComment = (line: string) => {
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let escaping = false;

	for (let index = 0; index < line.length; index++) {
		const character = line[index];

		if (character === '\\' && inDoubleQuote && !escaping) {
			escaping = true;
			continue;
		}

		if (character === '"' && !inSingleQuote && !escaping) {
			inDoubleQuote = !inDoubleQuote;
		} else if (character === '\'' && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
		} else if (character === '#' && !inSingleQuote && !inDoubleQuote) {
			return line.slice(0, index);
		}

		escaping = false;
	}

	return line;
};

const parseTomlKey = (rawKey: string) => {
	const key = rawKey.trim();
	if (
		(key.startsWith('"') && key.endsWith('"'))
		|| (key.startsWith('\'') && key.endsWith('\''))
	) {
		return key.slice(1, -1);
	}

	return key;
};

const parseTomlScalar = (rawValue: string): RawConfigValue => {
	const value = rawValue.trim();
	if (value === '') {
		return '';
	}

	if (value.startsWith('"') && value.endsWith('"')) {
		try {
			return JSON.parse(value) as string;
		} catch {
			return value.slice(1, -1);
		}
	}

	if (value.startsWith('\'') && value.endsWith('\'')) {
		return value.slice(1, -1);
	}

	if (/^(true|false)$/i.test(value)) {
		return value.toLowerCase() === 'true';
	}

	if (/^[+-]?\d+$/.test(value) || /^[+-]?\d+\.\d+$/.test(value)) {
		return Number(value);
	}

	return value;
};

const resolveTomlSection = (
	root: RawConfig,
	pathSegments: string[],
) => {
	let current: RawConfig = root;

	for (const pathSegment of pathSegments) {
		const next = current[pathSegment];
		if (!isObjectRecord(next)) {
			const created: RawConfig = Object.create(null);
			current[pathSegment] = created;
			current = created;
			continue;
		}

		current = next;
	}

	return current;
};

const parseTomlConfig = (content: string): RawConfig => {
	const parsed: RawConfig = Object.create(null);
	let currentSection = parsed;

	for (const rawLine of content.split(/\r?\n/)) {
		const line = stripTomlComment(rawLine).trim();
		if (!line) {
			continue;
		}

		if (line.startsWith('[') && line.endsWith(']')) {
			const rawSectionPath = line.slice(1, -1).trim();
			if (!rawSectionPath) {
				currentSection = parsed;
				continue;
			}

			const sectionSegments = rawSectionPath
				.split('.')
				.map(parseTomlKey)
				.map(segment => segment.trim())
				.filter(Boolean);
			if (sectionSegments.length === 0) {
				currentSection = parsed;
				continue;
			}

			currentSection = resolveTomlSection(parsed, sectionSegments);
			continue;
		}

		const separatorIndex = line.indexOf('=');
		if (separatorIndex <= 0) {
			continue;
		}

		const key = parseTomlKey(line.slice(0, separatorIndex));
		if (!key) {
			continue;
		}

		const value = parseTomlScalar(line.slice(separatorIndex + 1));
		currentSection[key] = value;
	}

	return parsed;
};

const formatTomlValue = (value: RawConfigValue) => {
	if (typeof value === 'string') {
		return JSON.stringify(value);
	}

	return String(value);
};

const stringifyTomlConfig = (config: RawConfig) => {
	const topLevelLines: string[] = [];
	const sectionBlocks: string[] = [];

	const emitSection = (
		pathSegments: string[],
		section: RawConfig,
	) => {
		const scalarLines: string[] = [];
		const childSections: [string, RawConfig][] = [];

		for (const [key, value] of Object.entries(section)) {
			const scalarValue = asRawConfigValue(value);
			if (scalarValue !== undefined) {
				scalarLines.push(`${key} = ${formatTomlValue(scalarValue)}`);
				continue;
			}

			if (isObjectRecord(value)) {
				childSections.push([key, value]);
			}
		}

		if (pathSegments.length > 0 && scalarLines.length > 0) {
			sectionBlocks.push(`[${pathSegments.join('.')}]`);
			sectionBlocks.push(...scalarLines);
			sectionBlocks.push('');
		}

		for (const [childKey, childSection] of childSections) {
			emitSection(
				[...pathSegments, childKey],
				childSection,
			);
		}
	};

	for (const [key, value] of Object.entries(config)) {
		const scalarValue = asRawConfigValue(value);
		if (scalarValue !== undefined) {
			topLevelLines.push(`${key} = ${formatTomlValue(scalarValue)}`);
			continue;
		}

		if (isObjectRecord(value)) {
			emitSection([key], value);
		}
	}

	while (sectionBlocks[sectionBlocks.length - 1] === '') {
		sectionBlocks.pop();
	}

	const parts = [
		...topLevelLines,
		...(topLevelLines.length > 0 && sectionBlocks.length > 0 ? [''] : []),
		...sectionBlocks,
	];

	return parts.join('\n');
};

const readTomlFileIfExists = async (targetPath: string): Promise<RawConfig | undefined> => {
	try {
		const stats = await fs.lstat(targetPath);
		if (!stats.isFile()) {
			return undefined;
		}

		const configString = await fs.readFile(targetPath, 'utf8');
		return parseTomlConfig(configString);
	} catch {
		return undefined;
	}
};

const readConfigFile = async (): Promise<RawConfig> => {
	const primaryConfig = await readTomlFileIfExists(configPath);
	if (primaryConfig) {
		return primaryConfig;
	}

	// Compatibility fallbacks for older config paths.
	for (const legacyConfigPath of legacyConfigPaths) {
		const legacyConfig = await readTomlFileIfExists(legacyConfigPath);
		if (legacyConfig) {
			return legacyConfig;
		}
	}

	return Object.create(null);
};

const readLegacyConfigValue = (
	key: ConfigKeys,
	config: RawConfig,
) => {
	const aliases = legacyConfigAliases[key];
	if (!aliases || aliases.length === 0) {
		return undefined;
	}

	for (const alias of aliases) {
		const value = asRawConfigValue(config[alias]);
		if (value !== undefined) {
			return value;
		}
	}

	return undefined;
};

const normalizeLegacyConfigKeys = (config: RawConfig) => {
	for (const [key, aliases] of Object.entries(legacyConfigAliases) as [ConfigKeys, string[]][]) {
		if (asRawConfigValue(config[key]) === undefined) {
			for (const alias of aliases) {
				const aliasValue = asRawConfigValue(config[alias]);
				if (aliasValue !== undefined) {
					config[key] = aliasValue;
					break;
				}
			}
		}

		for (const alias of aliases) {
			delete config[alias];
		}
	}
};

const readProfileConfigValue = (
	config: RawConfig,
	profileName: string,
	key: ConfigKeys,
) => {
	if (!profileName) {
		return undefined;
	}

	const profiles = config.profiles;
	if (!isObjectRecord(profiles)) {
		return undefined;
	}

	const selectedProfile = profiles[profileName];
	if (!isObjectRecord(selectedProfile)) {
		return undefined;
	}

	return asRawConfigValue(selectedProfile[key]);
};

export const getConfig = async (
	cliConfig?: CliConfig,
	suppressErrors?: boolean,
): Promise<ValidConfig> => {
	const config = await readConfigFile();
	const parsedConfig: Record<string, unknown> = {};
	const configuredProfile = (
		cliConfig?.profile
		?? asRawConfigValue(config.profile)
		?? readLegacyConfigValue('profile', config)
	);
	let selectedProfile = '';
	try {
		selectedProfile = configParsers.profile(configuredProfile);
	} catch {
		if (!suppressErrors) {
			throw new KnownError('Invalid config property profile: Must be a string');
		}
	}

	for (const key of Object.keys(configParsers) as ConfigKeys[]) {
		const parser = configParsers[key];
		const value = (
			cliConfig?.[key]
			?? (key === 'profile' ? undefined : readProfileConfigValue(config, selectedProfile, key))
			?? asRawConfigValue(config[key])
			?? readLegacyConfigValue(key, config)
		);

		if (suppressErrors) {
			try {
				parsedConfig[key] = parser(value);
			} catch {}
		} else {
			parsedConfig[key] = parser(value);
		}
	}

	return parsedConfig as ValidConfig;
};

export const setConfigs = async (
	keyValues: [key: string, value: string][],
) => {
	const config = await readConfigFile();
	normalizeLegacyConfigKeys(config);

	for (const [key, value] of keyValues) {
		if (!hasOwn(configParsers, key)) {
			throw new KnownError(`Invalid config property: ${key}`);
		}

		const normalizedKey = key as ConfigKeys;
		const parsed = configParsers[normalizedKey](value);
		config[normalizedKey] = parsed as RawConfigValue;

		const aliases = legacyConfigAliases[normalizedKey] || [];
		for (const alias of aliases) {
			delete config[alias];
		}
	}

	await fs.mkdir(configDirectoryPath, { recursive: true });
	const serialized = stringifyTomlConfig(config);
	await fs.writeFile(configPath, `${serialized}\n`, 'utf8');
};
