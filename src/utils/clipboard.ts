import { execa } from 'execa';

/**
 * Copy text to the system clipboard using native CLI tools.
 * macOS: pbcopy
 * Windows: clip
 * Linux: xclip (fallback to xsel)
 */
export async function copyToClipboard(message: string): Promise<boolean> {
	try {
		if (process.platform === 'darwin') {
			// macOS - use pbcopy
			await execa('pbcopy', { input: message });
		} else if (process.platform === 'win32') {
			// Windows - use clip
			await execa('clip', { input: message });
		} else {
			// Linux - try xclip first, fallback to xsel
			await execa('xclip', ['-selection', 'clipboard'], { input: message }).catch(
				() => execa('xsel', ['--clipboard', '--input'], { input: message }),
			);
		}
		return true;
	} catch {
		return false;
	}
}