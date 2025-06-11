import Chat from '#models/chat.model.mjs';
import { default as jwt } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { chatMsg } from '#routes/constants.js';
import { default as Utls } from '#services/Utilities.js';
import RouteController from '#rtControllers/route.controller.js';
//import Logger from "#dbg/Logger"

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
	/***
	 * TODO:  Needs error trapping for no existing chats
	 */
	async getMany(req, res, next) {
		const { chatfunc, condition } = this.#handleGetMany(req);

		try {
			const chats = await chatfunc;
			this.#handleSuccess(res, chats);
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err, condition);
		}
	}

	#handleGetMany(req) {
		const { prisoner, user, full, page, page_size } = req.query;
		const { limit, offset } = this.#handleLimits(page, page_size);
		const fullBool = full === 'true';

		let retvals;
		const ctype = !Utls.isUndefined(user)
			? 1 // Get chats by user
			: !Utls.isUndefined(prisoner)
				? 2 // Get chats by prisoner
				: 0; // Get all chats

		switch (ctype) {
			case 1:
				retvals = {
					chatfunc: Chat.readChatsByUser(user, fullBool, limit, offset),
					condition: 'par'
				};
				break;
			case 2:
				retvals = {
					chatfunc: Chat.readChatsByPrisoner(prisoner, fullBool, limit, offset),
					condition: 'par'
				};
				break;
			default:
				retvals = {
					chatfunc: Chat.readAllChats(fullBool, limit, offset),
					condition: 'par'
				};
				break;
		}
		return retvals;
	}

	// get one chat

	async getOne(req, res) {
		const { chatfunc, condition } = this.#handleGetOne(req);

		try {
			//  if (!(typeof chatfunc==='function')) throw new Error;
			const chat = await chatfunc;
			this.#handleSuccess(res, chat);
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err, condition);
		}
	}

	#handleGetOne(req) {
		const { id, user, prisoner, full: fullString } = req.query;
		const full = fullString === 'true';

		let retvals;

		const ctype = !Utls.isUndefined(id)
			? 1 // Get chat by id
			: !Utls.isUndefined(user) && !Utls.isUndefined(prisoner)
				? 2 // Get chat by user and prisoner
				: !Utls.isUndefined(user) || !Utls.isUndefined(prisoner)
					? 3 // Error missing either user or prisoner
					: 0; // Error empty params

		switch (ctype) {
			case 1:
				retvals = {
					chatfunc: Chat.readChatById(id, full),
					condition: 'par'
				};
				break;

			case 2:
				retvals = {
					chatfunc: Chat.readChatByUserAndPrisoner(user, prisoner, full),
					condition: 'par'
				};
				break;
			case 3:
				retvals = { condition: 'param' };
				break;
			default:
				retvals = { condition: 'empty' };
				break;
		}
		return retvals;
	}

	// Create
	async create(req, res) {
		const { user, prisoner } = req.body;
		try {
			const chat = await Chat.createChat({ user, prisoner });
			this.#handleSuccess(res, chat);
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err);
		}
	}

	// Update

	async update(req, res) {
		const newChat = req.body;
		try {
			const updatedRows = await Chat.updateChat(newChat);
			this.#handleSuccess(res, { updatedRows, newChat });
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err);
		}
	}

	// Delete
	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Chat.deleteChat(id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err);
		}
	}
}
