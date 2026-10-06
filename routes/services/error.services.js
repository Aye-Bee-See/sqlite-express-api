import { messages as msgConstants } from '#routes/constants.js';
import ValidationError from '#services/ValidationError.js';
import { bodyParserCondition, clientMessageFor, codeForRefusal } from '#services/error-codes.js';
import { HttpError } from '#services/HttpError.js';

/**
 * Final Express error middleware. Renders every error passed to next(err)
 * as JSON in the same shape RouteController.handleErr uses:
 *   { success: false, name, info, status }
 * Validation errors render as { success: false, errors: [...] }.
 * Internal faults (500) are logged and, outside NODE_ENV=development,
 * reported with a generic message only.
 */
export default class ErrorService {
	static handler;
	static {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */

		ErrorService.handler = ErrorService.#errorHandler.bind(this);
	}
	static #errorHandler(err, req, res, next) {
		if (res.headersSent) {
			return next(err);
		}
		const validationMessages = ValidationError.messagesFrom(err);
		if (validationMessages) {
			return res.status(400).json({
				success: false,
				errors: validationMessages,
				// The same failures, for a client that words them itself (README, "Error codes").
				problems:
					ValidationError.problemsFrom(err) ??
					validationMessages.map(() => ({
						field: null,
						code: 'validation_failed'
					}))
			});
		}
		const status = HttpError.statusOf(err);
		const development = process.env.NODE_ENV === 'development';
		const fallback = msgConstants.defaults.literal.http[status] || 'Error';
		const info = status >= 500 && !development ? fallback : clientMessageFor(err) || fallback;
		const body = {
			success: false,
			name: (err && err.name) || 'Error',
			info,
			status
		};
		if (status < 500) {
			// One key for a refusal, composed from the name and the condition that are
			// still sent beside it (README, "Error codes"). A 5xx is a fault rather
			// than a refusal and gets no code: there is nothing for a client to key on.
			body.code = codeForRefusal(err);
			const condition = bodyParserCondition(err) ?? (err && err.condition);
			if (typeof condition === 'string' && condition !== 'par') {
				body.condition = condition;
			}
		}
		if (status < 500 && err && Array.isArray(err.ids)) {
			// The records a refusal is about (a batch names the letters that stopped it),
			// so a client need not read them out of the sentence (#188).
			body.ids = err.ids;
		}
		if (status === 400) {
			// A 400 always carries problems, even when it was thrown as an HttpError
			// rather than a ValidationError: clients read one shape (README, "Errors").
			body.problems = [{ field: null, code: 'validation_failed' }];
		}
		if (status >= 500) {
			console.error(err);
			if (development && err && err.stack) {
				body.stack = err.stack;
			}
		}
		res.status(status).json(body);
	}
}
