export default class LoudError extends Error {
	constructor(title = 'ERROR', message = '', ...args) {
		super(message, ...args);
		console.group(
			'\x1b[48;2;255;92;0;38;2;253;230;255;1m%s\x1b[0m',
			' ****** ' + title + ' ***** '
		);
		console.error(this.message);
		console.groupEnd();
	}
}
