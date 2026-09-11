import { messages as msgConstants } from '#routes/constants.js';
import ValidationError from '#services/ValidationError.js';

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
		if (err) {
			const validationMessages = ValidationError.messagesFrom(err);
			if (validationMessages) {
				return res.status(400).json({ success: false, errors: validationMessages });
			}
			let { status, message, name } = err;
			const success = false;
			status = status || 400;
			const info = message || msgConstants.defaults.literal.http[status];

			res.status(status).json({ success, name, info, status });
		}
		next(req, res, next);
	}
}
