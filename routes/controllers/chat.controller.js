import Chat from '#models/chat.model.js';
import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { threadScope, resolveWriter } from '#rtServices/scope.services.js';
import { HttpError } from '#services/HttpError.js';
import LetterKey from '#models/letter-key.model.js';
import * as crypto from '#services/crypto.js';
import Message from '#models/message.model.js';
import { PRINTED, MAILED } from '#db/letter-status.js';

/**
 * Chat controller.
 *
 * Visibility follows threadScope(): users see their own threads, chapters
 * see the threads of writers their group manages, admins see everything.
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
	 * @throws {Error} a 403 error when the caller may not see it
	 */
	async #loadAllowed(scope, id) {
		const chat = await Chat.getChatByID(id);
		if (chat && !(await scope.allows(chat))) {
			throw scope.deny();
		}
		return chat;
	}

	/**
	 * Load a chat the caller may change or delete. Seeing a thread is not
	 * enough: a group that only mails a letter in it can read the thread, and
	 * the thread still belongs to the writer (or the group that manages them).
	 * @throws {Error} a 403 error when the caller may only read it, or not even that
	 */
	async #loadOwned(scope, id) {
		const chat = await this.#loadAllowed(scope, id);
		if (chat && !scope.allowsUser(chat.user)) {
			throw AuthzService.forbidden(
				'Only the writer, or the group that manages the writer, can change or delete this thread.'
			);
		}
		return chat;
	}

	/**
	 * e2e: attach the caller's envelopes to embedded and latest messages, and
	 * hide ciphertext the caller holds no envelope for (a group that was
	 * forwarded one letter must not receive the rest of the thread).
	 */
	async #e2eEnvelopes(chats, req, scope) {
		if (!crypto.isE2E() || chats.length === 0) {
			return;
		}
		const reader = {
			userId: req.user.id,
			chapterId: scope.chapterId || null,
			writerIds: scope.writerIds || [],
			all: scope.kind === 'all'
		};
		const embedded = chats.flatMap((c) => c.messages || []);
		const last = chats.map((c) => c.getDataValue('last_message')).filter(Boolean);
		const ids = [...embedded.map((m) => m.id), ...last.map((m) => m.id)];
		const map = await LetterKey.envelopeMap(ids, reader);
		for (const chat of chats) {
			if (chat.messages) {
				const readable = chat.messages.filter(
					(m) => reader.all || (map.get(m.id) || []).length > 0
				);
				for (const m of readable) {
					m.setDataValue('envelopes', map.get(m.id) || []);
				}
				chat.setDataValue('messages', readable);
			}
		}
		for (const m of last) {
			m.envelopes = map.get(m.id) || [];
			if (!reader.all && m.envelopes.length === 0) {
				for (const field of ['ciphertext', 'nonce', 'relayNoteCiphertext', 'relayNoteNonce']) {
					m[field] = null;
				}
			}
		}
	}

	/**
	 * List chats within the caller's scope. Filters: user (always the caller
	 * for user-role accounts; narrowed to the scope for chapters), prisoner,
	 * or both; none lists everything in scope.
	 */
	async getMany(req, res, next) {
		const { prisoner, user, full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { limit, offset } = limits;
		const fullBool = full === 'true';

		try {
			const scope = await threadScope(req);
			const publishedOnly = AuthzService.publishedOnly(req);
			// A user-role caller always lists their own threads, whatever `user` says.
			const writer = scope.kind === 'own' ? req.user.id : user;
			let chats;
			if (writer !== undefined) {
				const extra = { ...(prisoner !== undefined ? { prisoner } : {}), ...scope.where };
				chats = await Chat.readChatsByUser(writer, fullBool, limit, offset, extra, publishedOnly);
			} else if (prisoner !== undefined) {
				chats = await Chat.readChatsByPrisoner(
					prisoner,
					fullBool,
					limit,
					offset,
					scope.where,
					publishedOnly
				);
			} else {
				chats = await Chat.readAllChats(fullBool, limit, offset, scope.where, publishedOnly);
			}
			await Chat.attachLastMessages(chats.rows);
			await this.#e2eEnvelopes(chats.rows, req, scope);
			this.handlePage(res, chats, limits);
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * Get one chat, either by `id` or by the `user` + `prisoner` pair.
	 * A user-role caller may omit `user`; it defaults to their own id.
	 */
	async getOne(req, res, next) {
		const { id, prisoner, full: fullString } = req.query;
		const full = fullString === 'true';
		let condition = 'par';

		try {
			const scope = await threadScope(req);
			const publishedOnly = AuthzService.publishedOnly(req);
			const user =
				scope.kind === 'own' && req.query.user === undefined ? req.user.id : req.query.user;
			let chat;
			if (id !== undefined) {
				await this.#loadAllowed(scope, id);
				chat = await Chat.readChatById(id, full, publishedOnly);
			} else if (user !== undefined && prisoner !== undefined) {
				if (!scope.allowsUser(user)) {
					throw scope.deny();
				}
				chat = await Chat.readChatByUserAndPrisoner(user, prisoner, full, publishedOnly);
			} else if (user !== undefined || prisoner !== undefined) {
				condition = 'param';
				throw new HttpError(400, 'Both user and prisoner are required.');
			} else {
				condition = 'empty';
				throw new HttpError(400, 'Provide either id, or both user and prisoner.');
			}
			this.requireFound(chat, 'Chat');
			await this.#e2eEnvelopes([chat], req, scope);
			this.#handleSuccess(res, chat);
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar, condition);
		}
	}

	// Create
	async create(req, res, next) {
		const { prisoner } = req.body;
		try {
			const scope = await threadScope(req);
			const user = await resolveWriter(req, scope, req.body.user);
			const chat = await Chat.createChat({ user, prisoner });
			this.#handleSuccess(res, chat);
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
		const newChat = { ...req.body };
		try {
			const scope = await threadScope(req);
			if (scope.kind !== 'all') {
				const chat = await this.#loadOwned(scope, newChat.id);
				if (newChat.user !== undefined && !scope.allowsUser(newChat.user)) {
					throw AuthzService.forbidden(
						'A chat cannot be reassigned to a writer outside your scope.'
					);
				}
				const moves = ['user', 'prisoner'].some(
					(field) =>
						newChat[field] !== undefined && String(newChat[field]) !== String(chat?.[field])
				);
				if (chat && moves && (await Message.count({ where: { chat: chat.id } })) > 0) {
					// Each letter names its own writer and prisoner; moving the thread would split them.
					throw AuthzService.forbidden(
						'A thread that has letters cannot be moved to another writer or prisoner.'
					);
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
			const scope = await threadScope(req);
			const chat = await this.#loadOwned(scope, id);
			if (chat && scope.kind !== 'all') {
				const kept = await Message.count({
					where: { chat: chat.id, status: [PRINTED, MAILED] }
				});
				if (kept > 0) {
					// The same rule as DELETE /messaging/message: a letter that was printed or mailed is a record.
					throw AuthzService.forbidden(
						'This thread has letters that were already printed or mailed; it can no longer be deleted.'
					);
				}
			}
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
