import Message from '#models/message.model.js';
import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { threadScope, resolveWriter } from '#rtServices/scope.services.js';

/**
 * Message controller.
 *
 * Visibility follows threadScope(): users see their own messages, chapters
 * see messages of writers their group manages, admins see everything. A
 * user-role caller always sends as themselves and as the user side; a
 * chapter sends as a writer it manages (or its anonymous writer) and may
 * record either side.
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
	 * Load a message by id and confirm the caller may act on it.
	 * @returns {Promise<Message|null>}
	 * @throws {Error} a 403 error when the caller may not see it
	 */
	async #loadAllowed(scope, id) {
		const message = await Message.getMessageByID(id);
		if (message && !scope.allows(message)) {
			throw AuthzService.forbidden();
		}
		return message;
	}

	/**
	 * List messages. Exactly one filter is applied, in precedence order: id,
	 * chat, prisoner, user; with no filter, everything in the caller's scope.
	 * Paginated with page and page_size.
	 */
	async getMany(req, res, next) {
		const { id, chat, prisoner, user, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { limit, offset } = limits;

		try {
			const scope = await threadScope(req);
			let messages;
			if (id !== undefined) {
				messages = await Message.readMessageById(id, limit, offset, scope.where);
			} else if (chat !== undefined) {
				messages = await Message.readMessagesByChat(chat, limit, offset, scope.where);
			} else if (prisoner !== undefined) {
				messages = await Message.readMessagesByPrisoner(prisoner, limit, offset, scope.where);
			} else if (user !== undefined) {
				// A user-role caller always lists their own messages, whatever `user` says.
				const writer = scope.kind === 'own' ? req.user.id : user;
				if (!scope.allowsUser(writer)) {
					throw AuthzService.forbidden('Writer ' + writer + ' is outside your scope.');
				}
				messages = await Message.readMessagesByUser(writer, limit, offset);
			} else {
				messages = await Message.readAllMessages(limit, offset, scope.where);
			}
			this.handlePage(res, messages, limits);
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// get one message

	async getOne(req, res, next) {
		const { id } = req.query;
		try {
			const scope = await threadScope(req);
			const message = await this.#loadAllowed(scope, id);
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
	async create(req, res, next) {
		const { messageText, prisoner } = req.body;
		try {
			const scope = await threadScope(req);
			const user = await resolveWriter(req, scope, req.body.user);
			const sender = scope.kind === 'own' ? 'user' : req.body.sender;
			const message = await Message.createMessage({ messageText, sender, prisoner, user });
			this.#handleSuccess(res, message);
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update
	async update(req, res, next) {
		const newMessage = { ...req.body };
		try {
			const scope = await threadScope(req);
			if (scope.kind !== 'all') {
				await this.#loadAllowed(scope, newMessage.id);
				if (scope.kind === 'own') {
					newMessage.user = req.user.id;
				} else if (newMessage.user !== undefined && !scope.allowsUser(newMessage.user)) {
					throw AuthzService.forbidden(
						'Your group does not manage writer ' + newMessage.user + '.'
					);
				}
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
			const scope = await threadScope(req);
			await this.#loadAllowed(scope, id);
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
