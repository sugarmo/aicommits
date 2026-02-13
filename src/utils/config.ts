import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';
import type { TiktokenModel } from '@dqbd/tiktoken';
import { fileExists } from './fs.js';
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
	OPENAI_KEY(key?: unknown) {
		if (!key) {
			throw new KnownError('Please set your OpenAI API key via `aicommits config set OPENAI_KEY=<your token>`');
		}
		if (typeof key !== 'string') {
			throw new KnownError('Invalid config property OPENAI_KEY: Must be a string');
		}
		parseAssert('OPENAI_KEY', key.startsWith('sk-'), 'Must start with "sk-"');
		// Key can range from 43~51 characters. There's no spec to assert this.

		return key;
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
	temperature(temperature?: unknown) {
		if (temperature === undefined || temperature === null || temperature === '') {
			return undefined;
		}

		parseAssert('temperature', typeof temperature === 'string' || typeof temperature === 'number', 'Must be a number');
		const parsed = Number(temperature);

		parseAssert('temperature', Number.isFinite(parsed), 'Must be a number');
		parseAssert('temperature', parsed >= 0, 'Must be greater or equal to 0');
		parseAssert('temperature', parsed <= 2, 'Must be less or equal to 2');

		return parsed;
	},
	details(details?: unknown) {
		return parseBoolean('details', details, false);
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
} as const;

type ConfigKeys = keyof typeof configParsers;
type RawConfigValue = string | number | boolean;

type RawConfig = {
	[key in ConfigKeys]?: RawConfigValue;
};

export type ValidConfig = {
	[Key in ConfigKeys]: ReturnType<typeof configParsers[Key]>;
};

const configPath = path.join(os.homedir(), '.aicommits');

const readConfigFile = async (): Promise<RawConfig> => {
	const configExists = await fileExists(configPath);
	if (!configExists) {
		return Object.create(null);
	}

	const configString = await fs.readFile(configPath, 'utf8');
	return ini.parse(configString);
};

export const getConfig = async (
	cliConfig?: RawConfig,
	suppressErrors?: boolean,
): Promise<ValidConfig> => {
	const config = await readConfigFile();
	const parsedConfig: Record<string, unknown> = {};

	for (const key of Object.keys(configParsers) as ConfigKeys[]) {
		const parser = configParsers[key];
		const value = cliConfig?.[key] ?? config[key];

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

	for (const [key, value] of keyValues) {
		if (!hasOwn(configParsers, key)) {
			throw new KnownError(`Invalid config property: ${key}`);
		}

		const parsed = configParsers[key as ConfigKeys](value);
		config[key as ConfigKeys] = parsed as any;
	}

	await fs.writeFile(configPath, ini.stringify(config), 'utf8');
};
