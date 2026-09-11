/**
 * An error that knows which HTTP status it should produce.
 *
 * Throw these from controllers or models for client-caused failures.
 * Anything without a status is treated as an internal fault (500) by
 * RouteController.handleErr and ErrorService.handler.
 */
export class HttpError extends Error {
	/**
	 * @param {number} status HTTP status code
	 * @param {string} message human-readable explanation, safe to show to clients
	 * @param {string} [name] error name reported in the response
	 */
	constructor(status, message, name = 'HttpError') {
		super(message);
		this.name = name;
		this.status = status;
	}

	/**
	 * Decide the HTTP status for any error.
	 *
	 * - An explicit `status` (or `statusCode`) wins.
	 * - Sequelize constraint violations are the client's fault: 400.
	 * - Everything else is an internal fault: 500.
	 * @param {Error|null|undefined} err
	 * @returns {number}
	 */
	static statusOf(err) {
		if (!err) {
			return 500;
		}
		if (Number.isInteger(err.status)) {
			return err.status;
		}
		if (Number.isInteger(err.statusCode)) {
			return err.statusCode;
		}
		const clientFaults = {
			SequelizeUniqueConstraintError: 400,
			SequelizeForeignKeyConstraintError: 400,
			SequelizeValidationError: 400,
			ValidationError: 400
		};
		return clientFaults[err.name] ?? 500;
	}
}

/**
 * A requested record, parent record, or route does not exist.
 */
export class NotFoundError extends HttpError {
	/**
	 * @param {string} [message]
	 */
	constructor(message = 'Not found') {
		super(404, message, 'NotFoundError');
	}
}

export default HttpError;
