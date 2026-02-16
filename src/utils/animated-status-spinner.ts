import { gray, green, magenta } from 'kolorist';

export type AnimatedStatusSpinner = {
	start: (message: string) => void;
	update: (message: string) => void;
	stop: (message: string) => void;
};

export const createAnimatedStatusSpinner = (): AnimatedStatusSpinner => {
	// Animate via ASCII text (| / - \) to avoid glyph/size inconsistencies across symbols.
	const frames = ['|', '/', '-', '\\'];
	const intervalMs = process.stdout.isTTY ? 120 : 10_000;
	let frameIndex = 0;
	let message = '';
	let running = false;
	let intervalId: NodeJS.Timeout | undefined;
	const bar = gray('│');

	const renderLine = (line: string) => {
		if (!process.stdout.isTTY) {
			process.stdout.write(`${line}\n`);
			return;
		}

		process.stdout.write(`\r\u001B[2K${line}`);
	};

	const renderFrame = () => {
		const frame = frames[frameIndex];
		renderLine(`${magenta('◆')}  ${frame} ${message}`);
		frameIndex = (frameIndex + 1) % frames.length;
	};

	return {
		start(nextMessage: string) {
			message = nextMessage;
			if (running) {
				renderFrame();
				return;
			}

			running = true;
			if (process.stdout.isTTY) {
				process.stdout.write(`${bar}\n`);
				renderFrame();
				intervalId = setInterval(renderFrame, intervalMs);
				return;
			}

			renderLine(message);
		},
		update(nextMessage: string) {
			message = nextMessage;
			if (!running || !process.stdout.isTTY) {
				return;
			}
			renderFrame();
		},
		stop(nextMessage: string) {
			if (!running) {
				return;
			}

			running = false;
			if (intervalId) {
				clearInterval(intervalId);
				intervalId = undefined;
			}

			if (process.stdout.isTTY) {
				const lines = nextMessage.split(/\r?\n/);
				const firstLine = lines.shift() ?? '';
				process.stdout.write(`\r\u001B[2K${green('◆')}  ${firstLine}\n`);
				for (const line of lines) {
					process.stdout.write(`${bar}  ${line}\n`);
				}
				return;
			}

			process.stdout.write(`${nextMessage}\n`);
		},
	};
};
