import Message from '#models/message.model.js';
import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';

/**
 * Message controller.
 *
 * Ownership: callers with the plain "user" role only ever see, create, change,
 * or delete messages whose `user` column is their own id, and always send as
 * the user side of the conversation. Admins and chapters are unrestricted.
 */
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
	 * Extra where-clause for restricted callers, empty for everyone else.
	 */
	#ownerFilter(req) {
		return AuthzService.ownOnly(req) ? { user: req.user.id } : {};
	}

	/**
	 * Load a message by id and confirm the caller may act on it.
	 * @returns {Promise<Message|null>} the message, or null when it does not exist
	 * @throws {Error} a 403 error when the caller is restricted and does not own it
	 */
	async #loadOwned(req, id) {
		const message = await Message.getMessageByID(id);
		if (message && AuthzService.ownOnly(req) && !AuthzService.ownsRecord(req, message)) {
			throw AuthzService.forbidden();
		}
		return message;
	}

	/**
	 * List messages. Exactly one filter is applied, chosen in this order of
	 * precedence: id, chat, prisoner, user. With no filter, all messages are
	 * listed. All variants are paginated with page and page_size. Restricted
	 * callers only ever receive their own messages.
	 *
	 * The `full` flag is accepted for symmetry with other resources but the
	 * message model has no working eager-load yet, so it is ignored here.
	 */
	async getMany(req, res) {
		const { id, chat, prisoner, user, page, page_size } = req.query;
		const { limit, offset } = this.#handleLimits(page, page_size);
		const owner = this.#ownerFilter(req);

		try {
			let messages;
			if (id !== undefined) {
				messages = await Message.readMessageById(id, limit, offset, owner);
			} else if (chat !== undefined) {
				messages = await Message.readMessagesByChat(chat, limit, offset, owner);
			} else if (prisoner !== undefined) {
				messages = await Message.readMessagesByPrisoner(prisoner, limit, offset, owner);
			} else if (user !== undefined) {
				messages = await Message.readMessagesByUser(user, limit, offset, owner);
			} else {
				messages = await Message.readAllMessages(limit, offset, owner);
			}
			this.#handleSuccess(res, messages);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// get one message

	async getOne(req, res, next) {
		const { id } = req.query;
		try {
			const message = await this.#loadOwned(req, id);
			this.#handleSuccess(res, this.requireFound(message, 'Message ' + id));
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Create
	async create(req, res) {
		const { messageText, prisoner } = req.body;
		const restricted = AuthzService.ownOnly(req);
		const user = restricted ? req.user.id : req.body.user;
		const sender = restricted ? 'user' : req.body.sender;
		try {
			const message = await Message.createMessage({ messageText, sender, prisoner, user });
			this.#handleSuccess(res, message);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update
	async update(req, res, next) {
		const newMessage = { ...req.body };
		try {
			if (AuthzService.ownOnly(req)) {
				await this.#loadOwned(req, newMessage.id);
				newMessage.user = req.user.id;
			}
			const updatedRows = await Message.updateMessage(newMessage);
			this.requireAffected(updatedRows, 'Message ' + newMessage.id);
			this.#handleSuccess(res, { updatedRows, newMessage });
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Delete
	async remove(req, res, next) {
		const { id } = req.body;
		try {
			await this.#loadOwned(req, id);
			const deletedRows = await Message.deleteMessage(id);
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'Message ' + id));
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}
