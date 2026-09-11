import Message from '#models/message.model.js';
//import { default as jwt } from 'jsonwebtoken';
//import bcrypt from 'bcrypt';
//import { messageMsg } from '#routes/constants.js';
import RouteController from '#rtControllers/route.controller.js';

export default class MessageController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('message');
		this.getMany = this.getMany.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.remove = this.remove.bind(this);
		this.create = this.create.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	/**
	 * List messages. Exactly one filter is applied, chosen in this order of
	 * precedence: id, chat, prisoner, user. With no filter, all messages are
	 * listed. All variants are paginated with page and page_size.
	 *
	 * The `full` flag is accepted for symmetry with other resources but the
	 * message model has no working eager-load yet, so it is ignored here.
	 */
	async getMany(req, res) {
		const { id, chat, prisoner, user, page, page_size } = req.query;
		const { limit, offset } = this.#handleLimits(page, page_size);

		try {
			let messages;
			if (id !== undefined) {
				messages = await Message.readMessageById(id, limit, offset);
			} else if (chat !== undefined) {
				messages = await Message.readMessagesByChat(chat, limit, offset);
			} else if (prisoner !== undefined) {
				messages = await Message.readMessagesByPrisoner(prisoner, limit, offset);
			} else if (user !== undefined) {
				messages = await Message.readMessagesByUser(user, limit, offset);
			} else {
				messages = await Message.readAllMessages(limit, offset);
			}
			this.#handleSuccess(res, messages);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// get one message

	async getOne(req, res) {
		const { id } = req.query;
		try {
			const message = await Message.getMessageByID(id);
			this.#handleSuccess(res, message);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Create
	async create(req, res) {
		const { messageText, sender, prisoner, user } = req.body;
		try {
			const message = await Message.createMessage({ messageText, sender, prisoner, user });
			this.#handleSuccess(res, message);
			// res.status(200).json({msg: ruleMsg.post.create.success.condition.par, rule});
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update

	async update(req, res) {
		const newMessage = req.body;
		try {
			const updatedRows = await Message.updateMessage(newMessage);
			this.#handleSuccess(res, { updatedRows, newMessage });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Delete
	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Message.deleteMessage(id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}
