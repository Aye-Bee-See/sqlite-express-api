import LoudError from '#services/LoudError.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';

import { messages as msgConstants } from '#routes/constants.js';
/**
 * Interface for route controllers
 *
 * @interface
 *
 */

const RouteControllerInterface = {
	controllerName: '',
	getOne: function () {},
	getMany: function () {},
	update: function () {},
	remove: function () {},
	create: function () {}
};

/**
 * Route controller parent class
 *
 * @class RouteController
 *
 * @implements {RouteControllerInterface}
 */
export default class RouteController {
	#className = 'RouteController';
	#interfaceName = 'RouteControllerInterface';
	controllerName;
	constructor(name) {
		this.controllerName = name;
		this.#implementsInterface(this, RouteControllerInterface);
	}
	static DEFAULT_PAGE_SIZE = 10;
	static MAX_PAGE_SIZE = 100;

	/**
	 * Turn the page / page_size query parameters into Sequelize limit / offset.
	 * Both are optional; when present they must be positive integers, and
	 * page_size may not exceed MAX_PAGE_SIZE.
	 * @param {string|number|undefined} page 1-based page number
	 * @param {string|number|undefined} page_size rows per page
	 * @returns {{limit: number, offset: number, page: number, pageSize: number}}
	 * @throws {ValidationError} for non-numeric, fractional, zero, negative, or oversized values
	 */
	handleLimits(page, page_size) {
		const blank = (v) => v === undefined || v === null || v === '';
		const pageNum = blank(page) ? 1 : Number(page);
		const sizeNum = blank(page_size) ? RouteController.DEFAULT_PAGE_SIZE : Number(page_size);
		const errors = [];
		if (!Number.isInteger(pageNum) || pageNum < 1) {
			errors.push('page must be a positive integer.');
		}
		if (!Number.isInteger(sizeNum) || sizeNum < 1 || sizeNum > RouteController.MAX_PAGE_SIZE) {
			errors.push(
				'page_size must be an integer between 1 and ' + RouteController.MAX_PAGE_SIZE + '.'
			);
		}
		if (errors.length > 0) {
			throw new ValidationError(errors);
		}
		return { limit: sizeNum, offset: (pageNum - 1) * sizeNum, page: pageNum, pageSize: sizeNum };
	}

	/**
	 * Send one page of a list: `data` is the rows, and `total`, `page`, and
	 * `page_size` are added to the envelope so clients can paginate.
	 * @param {object} res
	 * @param {{rows: object[], count: number}} result from findAndCountAll
	 * @param {{page: number, pageSize: number}} limits from handleLimits
	 * @param {string} [condition]
	 */
	handlePage(res, result, limits, condition = 'par') {
		this.handleSuccess(res, result.rows, condition, {
			total: result.count,
			page: limits.page,
			page_size: limits.pageSize
		});
	}
	/*	#formatMessagesList(messagesList) {
		let formattedList = {};

		for (let i = 0; i < messagesList.length; i++) {
			const id = messagesList[i].dataValues.id;
			const ruleData = messagesList[i].dataValues;
			formattedList[id] = ruleData;
		}
		return formattedList;
	}
*/
	#findStack(res) {
		let stack;
		res.req.route.stack.forEach((layer) => {
			const fname = layer.name.substr(6);
			if (Object.hasOwn(this, fname)) {
				stack = layer;
			}
		});
		return stack;
	}

	handleSuccess(res, outObj = {}, condition = 'par', extra = {}) {
		const ctrlMsg = msgConstants[this.controllerName];
		const stack = this.#findStack(res);
		const callerName = stack.name.substr(6);
		const msgRef = ['getOne', 'getMany'].includes(callerName)
			? callerName.toLowerCase().substring(3)
			: callerName;
		const { method } = stack;
		// Creates answer 201; everything else (reads, updates, deletes, login) 200.
		const status = msgRef === 'create' ? 201 : 200;
		const message = {
			data: outObj,
			info: ctrlMsg[method][msgRef].success.condition[condition],
			success: true,
			status,
			name: this.controllerName + ' ' + msgRef,
			...extra
		};

		res.status(status).json(message);
	}

	/**
	 * Assert that a lookup found something.
	 * @template T
	 * @param {T|null|undefined} record
	 * @param {string} what description used in the 404 message, e.g. "Prison 7"
	 * @returns {T}
	 * @throws {NotFoundError}
	 */
	requireFound(record, what) {
		if (record === null || record === undefined) {
			throw new NotFoundError(what + ' not found');
		}
		return record;
	}

	/**
	 * Assert that an update or delete touched at least one row.
	 * @param {number|[number]} count Sequelize's affected-row count (update returns it in an array)
	 * @param {string} what description used in the 404 message
	 * @returns {number|[number]} the count, unchanged
	 * @throws {NotFoundError}
	 */
	requireAffected(count, what) {
		const n = Array.isArray(count) ? count[0] : count;
		if (!n) {
			throw new NotFoundError(what + ' not found');
		}
		return count;
	}

	static isDevelopment() {
		return process.env.NODE_ENV === 'development';
	}

	handleErr(res, errMsg = null, msgType = 'par') {
		// Validation failures (ours or Sequelize's) share one shape.
		const validationMessages = ValidationError.messagesFrom(errMsg);
		if (validationMessages) {
			return res.status(400).json({ success: false, errors: validationMessages });
		}
		const ctrlMsg = msgConstants[this.controllerName];
		const stack = this.#findStack(res);
		const callerName = stack.name.substr(6);
		const msgRef = ['getOne', 'getMany'].includes(callerName)
			? callerName.toLowerCase().substring(3)
			: callerName;
		const { method } = stack;
		const conditions = ctrlMsg[method][msgRef].error.condition;
		const info = conditions[msgType] ?? conditions.par;
		// No error object at all is treated as a generic client fault.
		const status = errMsg ? HttpError.statusOf(errMsg) : 400;
		const body = { success: false, name: errMsg ? errMsg.name : 'Error', info, status };
		if (errMsg && errMsg.message) {
			if (status < 500) {
				body.error = errMsg.message;
			} else if (RouteController.isDevelopment()) {
				body.error = errMsg.message;
				body.stack = errMsg.stack;
			}
		}
		if (status >= 500) {
			console.error('[' + this.controllerName + ' ' + msgRef + ']', errMsg);
		}

		res.status(status).json(body);
	}

	#implementsInterface(childObj, interfaceObj) {
		for (const property in interfaceObj) {
			if (!(property in childObj)) {
				console.log(
					childObj.constructor.name +
						' does not implement ' +
						this.#interfaceName +
						' for parent ' +
						this.#className
				);
				const title = childObj.constructor.name + ' must implement ' + property;
				const message =
					property +
					' in ' +
					childObj.constructor.name +
					' must be of type ' +
					typeof interfaceObj[property];
				throw new LoudError(title, message);
			}
		}
	}
}
