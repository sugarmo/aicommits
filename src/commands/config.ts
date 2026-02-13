import { command } from 'cleye';
import { red } from 'kolorist';
import { hasOwn, getConfig, setConfigs } from '../utils/config.js';
import { KnownError, handleCliError } from '../utils/error.js';

const parseKeyValue = (keyValue: string): [string, string] => {
	const index = keyValue.indexOf('=');

	if (index <= 0) {
		throw new KnownError(`Invalid config assignment: "${keyValue}". Use <key>=<value>.`);
	}

	return [
		keyValue.slice(0, index),
		keyValue.slice(index + 1),
	];
};

export default command({
	name: 'config',

	parameters: ['<mode>', '<key=value...>'],
}, (argv) => {
	(async () => {
		const { mode, keyValue: keyValues } = argv._;

		if (mode === 'get') {
			const config = await getConfig({}, true);
			for (const key of keyValues) {
				if (hasOwn(config, key)) {
					console.log(`${key}=${config[key as keyof typeof config]}`);
				}
			}
			return;
		}

		if (mode === 'set') {
			await setConfigs(
				keyValues.map(parseKeyValue),
			);
			return;
		}

		throw new KnownError(`Invalid mode: ${mode}`);
	})().catch((error) => {
		console.error(`${red('✖')} ${error.message}`);
		handleCliError(error);
		process.exit(1);
	});
});
