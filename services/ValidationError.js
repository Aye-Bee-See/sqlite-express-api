/**
 * Application-level input validation failure.
 *
 * Carries a list of human-readable messages and renders exactly like a
 * Sequelize validation error: HTTP 400 with `{ success: false, errors: [...] }`.
 * Both RouteController.handleErr and ErrorService.handler recognise it, so it
 * can be thrown from inside or outside a controller's try block.
 *
 * A message may also be given as `{ message, field, code, params }`, which adds
 * the machine-readable half clients translate from (`problems`; see
 * `services/error-codes.js` and README, "Error codes"). The sentence is
 * unchanged either way, so nothing that reads `errors` notices.
 */
import { codeForValidator, isKnownCode, paramsForValidator } from '#services/error-codes.js';

const MISSING_WHERE_VALUE = /^WHERE parameter "(\w+)" has invalid "undefined" value$/;

export default class ValidationError extends Error {
	/**
	 * @param {string|object|(string|object)[]} errors one or more messages, each
	 *   a sentence or `{ message, field, code, params }`
	 */
	constructor(errors) {
		const list = Array.isArray(errors) ? errors : [errors];
		const messages = list.map((item) => (typeof item === 'string' ? item : item.message));
		super(messages.join(' '));
		this.name = 'ValidationError';
		this.status = 400;
		this.errors = messages;
		this.problems = list.map((item) =>
			typeof item === 'string'
				? { field: null, code: 'validation_failed' }
				: ValidationError.#problem(item)
		);
	}

	/** One entry of `problems`, with a code the catalogue knows. */
	static #problem({ field = null, code = 'validation_failed', params }) {
		if (!isKnownCode(code)) {
			// A typo in a code would ship a contract no client can use; the catalogue
			// is the list, and this is the loudest place to say so that is not a 500.
			console.error('[errors] unknown code "' + code + '"; add it to services/error-codes.js');
			code = 'validation_failed';
		}
		return {
			field: field ?? null,
			code,
			...(params && Object.keys(params).length > 0 ? { params } : {})
		};
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

	/**
	 * The machine-readable half of the same failure, one entry per message and
	 * in the same order, so `errors[i]` and `problems[i]` are the same problem.
	 * Sequelize's own items say which field failed (`path`) and which validator
	 * (`validatorKey`), so every schema rule gets a code without being listed
	 * here; a custom validator lands on `validation_failed` and its sentence.
	 * @param {Error} err
	 * @returns {object[]|null} null when err is not a validation error
	 */
	static problemsFrom(err) {
		const missing = err && typeof err.message === 'string' && MISSING_WHERE_VALUE.exec(err.message);
		if (missing) {
			return [{ field: missing[1], code: 'required' }];
		}
		if (!err || !Array.isArray(err.errors)) {
			return null;
		}
		if (Array.isArray(err.problems) && err.problems.length === err.errors.length) {
			return err.problems;
		}
		if (err.name === 'ValidationError') {
			return err.errors.map(() => ({ field: null, code: 'validation_failed' }));
		}
		if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
			return err.errors.map((item) => {
				const params = paramsForValidator(item);
				return {
					field: item.path ?? null,
					code: codeForValidator(item),
					...(params ? { params } : {})
				};
			});
		}
		return null;
	}
}
