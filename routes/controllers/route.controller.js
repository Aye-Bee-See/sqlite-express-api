import LoudError from '#services/LoudError.js';
//import Utilities from '#services/Utilities.js';

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
	handleLimits(page, page_size) {
		const limit = page_size || 10;
		const list_start = page - 1 || 0;
		const offset = list_start * limit;
		return { limit, offset };
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
			if (this.hasOwn(fname)) {
				stack = layer;
			}
		});
		return stack;
	}

	handleSuccess(res, outObj = {}, condition = 'par') {
		const ctrlMsg = msgConstants[this.controllerName];
		const stack = this.#findStack(res);
		const callerName = stack.name.substr(6);
		const msgRef = ['getOne', 'getMany'].includes(callerName)
			? callerName.toLowerCase().substring(3)
			: callerName;
		const { method } = stack;
		let message = {};
		message['data'] = outObj;
		message['info'] = ctrlMsg[method][msgRef].success.condition[condition];
		message['success'] = true;
		message['status'] = 200;
		message['name'] = this.controllerName + ' ' + msgRef;

		res.status(200).json(message);
	}

	handleErr(res, errMsg = null, msgType = 'par') {
		// Handle Sequelize validation errors globally
		if (errMsg && errMsg.name === 'SequelizeValidationError' && errMsg.errors) {
			const messages = errMsg.errors.map((e) => e.message);
			return res.status(400).json({ success: false, errors: messages });
		}
		const ctrlMsg = msgConstants[this.controllerName];
		const stack = this.#findStack(res);
		const callerName = stack.name.substr(6);
		const msgRef = ['getOne', 'getMany'].includes(callerName)
			? callerName.toLowerCase().substring(3)
			: callerName;
		const { method } = stack;
		const info = ctrlMsg[method][msgRef].error.condition[msgType];
		const message = errMsg
			? { info: info, type: errMsg.name, error: errMsg.message, stack: errMsg.stack.toString() }
			: { info: info };

		res.status(400).json(message);
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
