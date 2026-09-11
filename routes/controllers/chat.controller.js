import Chat from '#models/chat.model.js';
import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { HttpError } from '#services/HttpError.js';

/**
 * Chat controller.
 *
 * Ownership: callers with the plain "user" role only ever see, create, change,
 * or delete chats whose `user` column is their own id. Admins and chapters are
 * unrestricted.
 */
export default class ChatController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('chat');
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
	 * Load a chat by id and confirm the caller may act on it.
	 * @returns {Promise<Chat|null>} the chat, or null when it does not exist
	 * @throws {Error} a 403 error when the caller is restricted and does not own it
	 */
	async #loadOwned(req, id) {
		const chat = await Chat.getChatByID(id);
		if (chat && AuthzService.ownOnly(req) && !AuthzService.ownsRecord(req, chat)) {
			throw AuthzService.forbidden();
		}
		return chat;
	}

	/**
	 * List chats. Filters, in precedence order: user, prisoner, none.
	 * A restricted caller is always filtered to their own user id; for them a
	 * `prisoner` parameter narrows within their own chats.
	 */
	async getMany(req, res) {
		const { prisoner, user, full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { limit, offset } = limits;
		const fullBool = full === 'true';
		const restricted = AuthzService.ownOnly(req);

		try {
			let chats;
			if (restricted) {
				const extra = prisoner !== undefined ? { prisoner } : {};
				chats = await Chat.readChatsByUser(req.user.id, fullBool, limit, offset, extra);
			} else if (user !== undefined) {
				chats = await Chat.readChatsByUser(user, fullBool, limit, offset);
			} else if (prisoner !== undefined) {
				chats = await Chat.readChatsByPrisoner(prisoner, fullBool, limit, offset);
			} else {
				chats = await Chat.readAllChats(fullBool, limit, offset);
			}
			this.handlePage(res, chats, limits);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * Get one chat, either by `id` or by the `user` + `prisoner` pair.
	 * A restricted caller may omit `user`; it defaults to their own id.
	 */
	async getOne(req, res, next) {
		const { id, prisoner, full: fullString } = req.query;
		const full = fullString === 'true';
		const restricted = AuthzService.ownOnly(req);
		const user = restricted && req.query.user === undefined ? req.user.id : req.query.user;
		let condition = 'par';

		try {
			let chat;
			if (id !== undefined) {
				await this.#loadOwned(req, id);
				chat = await Chat.readChatById(id, full);
			} else if (user !== undefined && prisoner !== undefined) {
				if (restricted && String(user) !== String(req.user.id)) {
					throw AuthzService.forbidden();
				}
				chat = await Chat.readChatByUserAndPrisoner(user, prisoner, full);
			} else if (user !== undefined || prisoner !== undefined) {
				condition = 'param';
				throw new HttpError(400, 'Both user and prisoner are required.');
			} else {
				condition = 'empty';
				throw new HttpError(400, 'Provide either id, or both user and prisoner.');
			}
			this.#handleSuccess(res, this.requireFound(chat, 'Chat'));
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar, condition);
		}
	}

	// Create
	async create(req, res) {
		const { prisoner } = req.body;
		const user = AuthzService.ownOnly(req) ? req.user.id : req.body.user;
		try {
			const chat = await Chat.createChat({ user, prisoner });
			this.#handleSuccess(res, chat);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update
	async update(req, res, next) {
		const newChat = { ...req.body };
		try {
			if (AuthzService.ownOnly(req)) {
				await this.#loadOwned(req, newChat.id);
				if (newChat.user !== undefined && String(newChat.user) !== String(req.user.id)) {
					throw AuthzService.forbidden('A chat cannot be reassigned to another user.');
				}
			}
			const updatedRows = await Chat.updateChat(newChat);
			this.requireAffected(updatedRows, 'Chat ' + newChat.id);
			this.#handleSuccess(res, { updatedRows, newChat });
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
			const deletedRows = await Chat.deleteChat(id);
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'Chat ' + id));
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}
