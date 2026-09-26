import { messages as msgConstants } from '#routes/constants.js';
import ValidationError from '#services/ValidationError.js';
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
		const info = status >= 500 && !development ? fallback : (err && err.message) || fallback;
		const body = { success: false, name: (err && err.name) || 'Error', info, status };
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
