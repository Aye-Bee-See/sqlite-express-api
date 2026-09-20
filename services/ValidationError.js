/**
 * Application-level input validation failure.
 *
 * Carries a list of human-readable messages and renders exactly like a
 * Sequelize validation error: HTTP 400 with `{ success: false, errors: [...] }`.
 * Both RouteController.handleErr and ErrorService.handler recognise it, so it
 * can be thrown from inside or outside a controller's try block.
 */
const MISSING_WHERE_VALUE = /^WHERE parameter "(\w+)" has invalid "undefined" value$/;

export default class ValidationError extends Error {
	/**
	 * @param {string|string[]} errors one or more messages
	 */
	constructor(errors) {
		const list = Array.isArray(errors) ? errors : [errors];
		super(list.join(' '));
		this.name = 'ValidationError';
		this.status = 400;
		this.errors = list;
	}

	/**
	 * Messages from either this class or a SequelizeValidationError.
	 * @param {Error} err
	 * @returns {string[]|null} null when err is not a validation error
	 */
	static messagesFrom(err) {
		// A missing id reaches Sequelize as `where: { id: undefined }`, which it
		// refuses with a plain Error: the caller's mistake, not a server fault.
		const missing = err && typeof err.message === 'string' && MISSING_WHERE_VALUE.exec(err.message);
		if (missing) {
			return [missing[1] + ' is required.'];
		}
		if (!err || !Array.isArray(err.errors)) {
			return null;
		}
		if (err.name === 'ValidationError' || err.name === 'SequelizeValidationError') {
			return err.errors.map((e) => (typeof e === 'string' ? e : e.message));
		}
		return null;
	}
}
