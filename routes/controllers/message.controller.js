import { Op } from 'sequelize';
import Message from '#models/message.model.js';
import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { threadScope, resolveWriter } from '#rtServices/scope.services.js';
import ValidationError from '#services/ValidationError.js';
import { isOpen, LETTER_STATUSES, RETURNED } from '#db/letter-status.js';
import Attachment from '#models/attachment.model.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';
import { sniffType } from '#services/files.js';
import { audit } from '#rtServices/audit.services.js';
import { notify, membersOf } from '#rtServices/notify.services.js';
import { begin as beginIdempotent, markReplayed } from '#rtServices/idempotency.services.js';
import LetterKey from '#models/letter-key.model.js';
import * as crypto from '#services/crypto.js';
import User from '#models/user.model.js';
import { retentionDefaultDays, retentionMaxDays } from '#constants';
import { windowFor } from '#db/retention.js';

/** How many letters PUT /messaging/status/batch moves at once. */
const BATCH_LIMIT = 200;

/**
 * Message (letter) controller.
 *
 * Visibility follows threadScope(): users see their own messages, chapters
 * see messages of writers their group manages plus letters the group
 * relays, admins see everything. A user-role caller always sends as
 * themselves and as the user side; a chapter sends as a writer it manages
 * (or its anonymous writer) and may record either side.
 *
 * Lifecycle: letters start `queued`; the relay group moves them to
 * `printed` and `mailed` through updateStatus. Replies are `received`.
 * Non-admins may edit or delete a letter only while it is still open.
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
		this.updateStatus = this.updateStatus.bind(this);
		this.updateStatusBatch = this.updateStatusBatch.bind(this);
		this.createEnvelope = this.createEnvelope.bind(this);
		this.missingEnvelopes = this.missingEnvelopes.bind(this);
		this.retention = this.retention.bind(this);
		this.remove = this.remove.bind(this);
		this.create = this.create.bind(this);
		this.createAttachment = this.createAttachment.bind(this);
		this.attachments = this.attachments.bind(this);
		this.getAttachment = this.getAttachment.bind(this);
		this.removeAttachment = this.removeAttachment.bind(this);

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
		// Only the user role is limited to published embeds; staff scopes see everything.
		const message = await Message.getMessageByID(id, scope.kind === 'own');
		if (message && !(await scope.allowsMessage(message))) {
			throw scope.deny();
		}
		return message;
	}

	/** Who is reading, for envelope lookups (e2e mode). */
	#reader(req, scope) {
		return {
			userId: req.user.id,
			chapterId: scope.chapterId || null,
			writerIds: scope.writerIds || [],
			all: scope.kind === 'all'
		};
	}

	/**
	 * A reply tells the writer; a new letter tells the group that will print it.
	 * (notify never throws and never tells the account that did it.)
	 */
	async #announce(req, message) {
		const what = { chat: message.chat, message: message.id };
		if (message.sender === 'prisoner') {
			await notify([message.user], { event: 'letter.reply', ...what }, { actor: req.user.id });
		} else if (message.relayChapter) {
			await notify(
				await membersOf(message.relayChapter),
				{ event: 'letter.queued', ...what },
				{ actor: req.user.id }
			);
		}
	}

	/** In e2e mode, attach the caller's envelopes to message rows. */
	async #withEnvelopes(rows, req, scope) {
		return await LetterKey.envelopesFor(rows, this.#reader(req, scope));
	}

	/** Route a 403 to the error middleware; render anything else here. */
	#fail(res, next, err, condition) {
		if (err && err.status === 403) {
			return next(err);
		}
		const errorVar = !(err instanceof Error) ? new Error(err) : err;
		this.#handleErr(res, errorVar, condition);
	}

	/**
	 * Optional list filters on top of the scope: `status` and `relayChapter`.
	 * @throws {ValidationError} for an unknown status
	 */
	#listFilters(query) {
		const filters = {};
		if (query.status !== undefined) {
			if (!LETTER_STATUSES.includes(query.status)) {
				throw new ValidationError('Status must be one of ' + LETTER_STATUSES.join(', ') + '.');
			}
			filters.status = query.status;
		}
		if (query.relayChapter !== undefined) {
			filters.relayChapter = query.relayChapter;
		}
		if (query.held !== undefined) {
			if (!['true', 'false'].includes(query.held)) {
				throw new ValidationError('held must be true or false.');
			}
			filters.heldReason = query.held === 'true' ? { [Op.ne]: null } : null;
		}
		return filters;
	}

	/**
	 * List messages. Exactly one selector is applied, in precedence order: id,
	 * chat, prisoner, user; with none, everything in the caller's scope.
	 * `status` and `relayChapter` narrow any of those. Paginated with page
	 * and page_size.
	 */
	async getMany(req, res, next) {
		const { id, chat, prisoner, user, page, page_size, full } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { limit, offset } = limits;

		try {
			const scope = await threadScope(req);
			const where = { ...this.#listFilters(req.query), ...scope.messageWhere };
			const publishedOnly = AuthzService.publishedOnly(req);
			let messages;
			if (id !== undefined) {
				messages = await Message.readMessageById(id, limit, offset, where, publishedOnly);
			} else if (chat !== undefined) {
				messages = await Message.readMessagesByChat(chat, limit, offset, where, publishedOnly);
			} else if (prisoner !== undefined) {
				messages = await Message.readMessagesByPrisoner(
					prisoner,
					limit,
					offset,
					where,
					publishedOnly
				);
			} else if (user !== undefined) {
				// A user-role caller always lists their own messages, whatever `user` says.
				const writer = scope.kind === 'own' ? req.user.id : user;
				messages = await Message.readMessagesByUser(writer, limit, offset, where, publishedOnly);
			} else {
				messages = await Message.readAllMessages(limit, offset, where, publishedOnly);
			}
			if (full === 'true') {
				// What a group needs to print and address a page of its queue, without a
				// request per letter: the prisoner, the facility with its rules, the writer.
				await Message.attachPrintDetails(messages.rows, publishedOnly);
			}
			await this.#withEnvelopes(messages.rows, req, scope);
			this.handlePage(res, messages, limits);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** Get one message by id; `full=true` embeds the relay group and status history. */
	async getOne(req, res, next) {
		const { id, full } = req.query;
		try {
			const scope = await threadScope(req);
			const message = await this.#loadAllowed(scope, id);
			this.requireFound(message, 'Message ' + id);
			const publishedOnly = AuthzService.publishedOnly(req);
			const row = full === 'true' ? await Message.readLetter(id, publishedOnly) : message;
			if (full === 'true') {
				await Message.attachPrintDetails([row], publishedOnly);
			}
			await this.#withEnvelopes([row], req, scope);
			this.#handleSuccess(res, row);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * Send a letter (sender `user`) or record a reply (sender `prisoner`).
	 * Body: messageText, sender, prisoner, user?, relayChapter?, relayNote?.
	 * The relay group is resolved from the facility's relay groups when not
	 * given; see Message.resolveRelayChapter.
	 */
	async create(req, res, next) {
		const { messageText, prisoner, relayChapter, relayNote } = req.body;
		let idempotent = null;
		try {
			const scope = await threadScope(req);
			const sender = scope.kind === 'own' ? 'user' : req.body.sender;
			const user = await resolveWriter(req, scope, req.body.user, { sender, prisoner });
			const fields = { sender, prisoner, user, relayChapter, resendOf: req.body.resendOf };
			if (crypto.isE2E()) {
				const { ciphertext, nonce, relayNoteCiphertext, relayNoteNonce } = req.body;
				Object.assign(fields, { ciphertext, nonce, relayNoteCiphertext, relayNoteNonce });
				if (messageText !== undefined) {
					fields.messageText = messageText;
				}
				if (relayNote !== undefined) {
					fields.relayNote = relayNote;
				}
			} else {
				Object.assign(fields, { messageText, relayNote });
			}
			// With an Idempotency-Key a retry gets the letter the first attempt made, not
			// a second one. Who it is from and to must match; in server mode the text too
			// (in e2e a retry may have been encrypted afresh, so ciphertext cannot be compared).
			idempotent = await beginIdempotent(req, res, 'message', [
				sender,
				Number(prisoner),
				Number(user),
				crypto.isE2E() ? null : (messageText ?? null),
				// Which returned letter this one replaces is part of what is being asked.
				// Added only when present, so that the fingerprint of every other letter
				// (and of any retry already on its way across a deploy) stays what it was.
				...(fields.resendOf === undefined || fields.resendOf === null || fields.resendOf === ''
					? []
					: ['resendOf', Number(fields.resendOf)])
			]);
			if (idempotent && 'replay' in idempotent) {
				const original = await Message.findByPk(idempotent.replay);
				idempotent = null;
				if (!original) {
					throw new HttpError(
						410,
						'The letter this Idempotency-Key created no longer exists; it will not be sent again.',
						'IdempotencyError'
					);
				}
				await this.#withEnvelopes([original], req, scope);
				markReplayed(res);
				return this.#handleSuccess(res, original);
			}
			const message = await Message.createLetter(fields, {
				callerChapter: scope.chapterId || null,
				changedBy: req.user.id,
				envelopes: req.body.envelopes
			});
			if (idempotent) {
				// It exists now, so the key is never freed from here on. complete() does
				// not throw: it retries, and the client is told the truth either way.
				const claim = idempotent;
				idempotent = null;
				await claim.complete(message.id);
			}
			await this.#withEnvelopes([message], req, scope);
			await this.#announce(req, message);
			this.#handleSuccess(res, message);
		} catch (err) {
			// Nothing was made: free the key, so a corrected request may use it again.
			if (idempotent && idempotent.release) {
				await idempotent.release().catch(() => {});
			}
			this.#fail(res, next, err);
		}
	}

	/**
	 * Reading a letter is not enough to change or delete it. A group that only
	 * mails a letter reads it, and the words stay the writer's: that group may
	 * correct or remove a reply it recorded, and nothing else.
	 * @throws {Error} 403
	 */
	#requireOwnSide(scope, message) {
		if (!message || scope.kind === 'all' || scope.allowsUser(message.user)) {
			return;
		}
		const recordedHere =
			message.sender === 'prisoner' &&
			Boolean(scope.chapterId) &&
			message.relayChapter === scope.chapterId;
		if (!recordedHere) {
			throw AuthzService.forbidden(
				'Only the writer, or the group that manages the writer, can change or delete this letter.'
			);
		}
	}

	/**
	 * Edit a message. Status fields are not editable here (see updateStatus);
	 * non-admins may only edit a letter that is still open and may not move
	 * it to a writer outside their scope.
	 */
	async update(req, res, next) {
		const newMessage = { ...req.body };
		for (const field of ['status', 'statusChangedAt', 'statusChangedBy']) {
			delete newMessage[field];
		}
		try {
			const scope = await threadScope(req);
			if (scope.kind !== 'all') {
				const current = await this.#loadAllowed(scope, newMessage.id);
				this.#requireOwnSide(scope, current);
				// Pinning (keep) is the one edit allowed on a mailed letter.
				const onlyKeep = Object.keys(newMessage).every((k) => ['id', 'keep'].includes(k));
				if (current && !isOpen(current.status) && !onlyKeep) {
					throw AuthzService.forbidden('A ' + current.status + ' letter can no longer be edited.');
				}
				if (scope.kind === 'own') {
					newMessage.user = req.user.id;
				} else if (newMessage.user !== undefined && !scope.allowsUser(newMessage.user)) {
					throw AuthzService.forbidden(
						'Your group does not manage writer ' + newMessage.user + '.'
					);
				}
			}
			const current =
				newMessage.relayChapter !== undefined || newMessage.prisoner !== undefined
					? await Message.getMessageByID(newMessage.id)
					: null;
			const moved =
				current &&
				newMessage.prisoner !== undefined &&
				String(newMessage.prisoner) !== String(current.prisoner);
			if (newMessage.relayChapter !== undefined || moved) {
				// A letter moved to another prisoner is routed again, as a new letter
				// would be: the group that mailed to the old facility may not serve the new one.
				if (current) {
					newMessage.relayChapter = await Message.resolveRelayChapter(
						newMessage.prisoner ?? current.prisoner,
						newMessage.relayChapter,
						scope.chapterId || null
					);
				}
			}
			const updatedRows = await Message.updateMessage(newMessage);
			this.requireAffected(updatedRows, 'Message ' + newMessage.id);
			this.#handleSuccess(res, { updatedRows, newMessage });
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * PUT /messaging/status { id, status }: move a letter along its
	 * lifecycle. Admins, or the group that relays the letter.
	 */
	async updateStatus(req, res, next) {
		const { id, status, reason, note, release } = req.body;
		try {
			const message = this.requireFound(await Message.getMessageByID(id), 'Message ' + id);
			const chapterId = await AuthzService.activeChapterOf(req);
			const mayChange =
				AuthzService.isAdmin(req) || (chapterId && message.relayChapter === chapterId);
			if (!mayChange && AuthzService.hasRole(req, AuthzService.CHAPTER) && !chapterId) {
				throw await AuthzService.groupRefusal(req);
			}
			if (!mayChange) {
				throw AuthzService.forbidden(
					'Only the relay group or an admin can change a letter status.'
				);
			}
			const from = message.status;
			const updated = await Message.changeStatus(message, status, req.user.id, {
				reason,
				note,
				release
			});
			await audit(req, 'letter.status', 'message', updated.id, {
				from,
				to: status,
				...(updated.returnReason ? { reason: updated.returnReason } : {})
			});
			await notify(
				[updated.user],
				{
					event: 'letter.status',
					chat: updated.chat,
					message: updated.id,
					detail: {
						status: updated.status,
						...(updated.returnReason ? { reason: updated.returnReason } : {})
					}
				},
				{ actor: req.user.id }
			);
			await this.#withEnvelopes([updated], req, await threadScope(req));
			this.#handleSuccess(res, updated);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * POST /messaging/envelope { message, readerType, readerId, wrappedKey }
	 * (e2e): a current reader hands the content key to one more permitted
	 * reader, for example a partner relay group.
	 */
	async createEnvelope(req, res, next) {
		const { message: messageId, readerType, readerId, wrappedKey, keyVersion } = req.body;
		try {
			if (!crypto.isE2E()) {
				throw new HttpError(
					409,
					'Envelopes are managed by the server in server mode.',
					'EncryptionModeError'
				);
			}
			const scope = await threadScope(req);
			const message = await this.#attachableMessage(req, scope, messageId, { forWrite: false });
			if (!(await LetterKey.canRead(message.id, this.#reader(req, scope)))) {
				throw AuthzService.forbidden('Only a current reader of the letter can add a reader.');
			}
			const envelope = await Message.addEnvelope(message, {
				readerType,
				readerId,
				wrappedKey,
				keyVersion
			});
			await audit(req, 'letter.envelope', 'message', message.id, {
				readerType: envelope.readerType,
				readerId: envelope.readerId
			});
			this.#handleSuccess(res, envelope);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /messaging/envelopes/missing: letters the caller's group can open
	 * whose writer has keys by now and no envelope yet. The group's client
	 * fills them in with POST /messaging/envelope; only it can, because only
	 * a reader can open the content key.
	 */
	async missingEnvelopes(req, res, next) {
		try {
			if (!crypto.isE2E()) {
				throw new HttpError(
					409,
					'Envelopes are managed by the server in server mode.',
					'EncryptionModeError'
				);
			}
			const chapterId = await AuthzService.activeChapterOf(req);
			if (!chapterId) {
				throw AuthzService.forbidden('Only a member of an active group holds group envelopes.');
			}
			this.#handleSuccess(res, await LetterKey.missingForWriters(chapterId));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /messaging/retention: the site's retention rules and the window
	 * that applies to the caller.
	 */
	async retention(req, res, next) {
		try {
			const me = await User.findByPk(req.user.id, { attributes: ['id', 'retentionDays'] });
			this.#handleSuccess(res, {
				defaultDays: retentionDefaultDays,
				maxDays: retentionMaxDays,
				chosenDays: me ? me.retentionDays : null,
				effectiveDays: windowFor(me),
				coversReplies: true
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	// Attachments

	/**
	 * Load a message the caller may see; non-admins may only change its
	 * attachments while the letter is still open.
	 */
	async #attachableMessage(req, scope, messageId, { forWrite }) {
		const message = this.requireFound(
			await this.#loadAllowed(scope, messageId),
			'Message ' + messageId
		);
		if (forWrite && scope.kind !== 'all' && !isOpen(message.status)) {
			throw AuthzService.forbidden(
				'Attachments of a ' + message.status + ' letter can no longer be changed.'
			);
		}
		return message;
	}

	/**
	 * POST /messaging/attachment (multipart): field `file` plus `message`.
	 * The file's bytes must match its declared type.
	 */
	async createAttachment(req, res, next) {
		const { message: messageId } = req.body;
		let idempotent = null;
		try {
			if (!req.file) {
				throw new ValidationError('Send the file in a multipart field named "file".');
			}
			if (messageId === undefined || messageId === '') {
				throw new ValidationError('message (the id of the letter) is required.');
			}
			const scope = await threadScope(req);
			const message = await this.#attachableMessage(req, scope, messageId, { forWrite: true });
			let mimeType = req.file.mimetype;
			let nonce;
			if (crypto.isE2E()) {
				// The bytes are ciphertext; the declared type describes the plaintext.
				nonce = req.body.nonce;
				if (typeof nonce !== 'string' || nonce === '') {
					throw new ValidationError('End-to-end mode: send the file nonce in a "nonce" field.');
				}
			} else {
				mimeType = sniffType(req.file.buffer);
				if (!mimeType || mimeType !== req.file.mimetype) {
					throw new ValidationError(
						'The file content does not match its type ' + req.file.mimetype + '.'
					);
				}
			}
			// The same key on a retried upload returns the file already stored. The
			// letter, the name, and the size must match; bytes are not compared (in
			// e2e a retry may carry fresh ciphertext).
			idempotent = await beginIdempotent(req, res, 'attachment', [
				message.id,
				req.file.originalname,
				crypto.isE2E() ? null : req.file.size
			]);
			if (idempotent && 'replay' in idempotent) {
				const original = await Attachment.findByPk(idempotent.replay);
				idempotent = null;
				if (!original) {
					throw new HttpError(
						410,
						'The attachment this Idempotency-Key created no longer exists; it will not be stored again.',
						'IdempotencyError'
					);
				}
				markReplayed(res);
				return this.#handleSuccess(res, original);
			}
			const attachment = await Attachment.attach({
				message: message.id,
				buffer: req.file.buffer,
				mimeType,
				originalName: req.file.originalname,
				uploadedBy: req.user.id,
				nonce
			});
			if (idempotent) {
				// It exists now, so the key is never freed from here on. complete() does
				// not throw: it retries, and the client is told the truth either way.
				const claim = idempotent;
				idempotent = null;
				await claim.complete(attachment.id);
			}
			this.#handleSuccess(res, attachment);
		} catch (err) {
			if (idempotent && idempotent.release) {
				await idempotent.release().catch(() => {});
			}
			this.#fail(res, next, err);
		}
	}

	/** GET /messaging/attachments?message=: the attachments of one message. */
	async attachments(req, res, next) {
		const { message: messageId } = req.query;
		try {
			if (messageId === undefined) {
				throw new ValidationError('message (the id of the letter) is required.');
			}
			const scope = await threadScope(req);
			const message = await this.#attachableMessage(req, scope, messageId, { forWrite: false });
			this.#handleSuccess(res, await Attachment.listForMessage(message.id));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /messaging/attachment?id=: download the file. */
	async getAttachment(req, res, next) {
		const { id } = req.query;
		try {
			const attachment = this.requireFound(await Attachment.withFile(id), 'Attachment ' + id);
			const scope = await threadScope(req);
			await this.#attachableMessage(req, scope, attachment.message, { forWrite: false });
			const bytes = await Attachment.readBytes(attachment);
			if (!bytes) {
				throw new NotFoundError('Attachment ' + id + ' file is missing from storage');
			}
			const safeName = (attachment.originalName || attachment.storedName).replace(
				/[^\w.\-() ]+/g,
				'_'
			);
			res.setHeader(
				'Content-Type',
				crypto.isE2E() ? 'application/octet-stream' : attachment.mimeType
			);
			if (crypto.isE2E()) {
				res.setHeader('X-Encrypted', 'e2e');
			}
			res.setHeader('Content-Length', bytes.length);
			res.setHeader('Content-Disposition', 'attachment; filename="' + safeName + '"');
			res.send(bytes);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** DELETE /messaging/attachment { id }. */
	async removeAttachment(req, res, next) {
		const { id } = req.body;
		try {
			const attachment = this.requireFound(await Attachment.findByPk(id), 'Attachment ' + id);
			const scope = await threadScope(req);
			await this.#attachableMessage(req, scope, attachment.message, { forWrite: true });
			this.#handleSuccess(res, await Attachment.remove(id));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * PUT /messaging/status/batch { ids, status, reason?, note?, release? }: move up to
	 * BATCH_LIMIT letters along together, all or none. The rules of each move are those
	 * of PUT /messaging/status; one audit entry, and one notification per writer.
	 */
	async updateStatusBatch(req, res, next) {
		const { ids, status, reason, note, release } = req.body;
		try {
			const wanted = MessageController.#batchIds(ids);
			const found = await Message.findAll({ where: { id: wanted }, hooks: false });
			const missing = wanted.filter((id) => !found.some((message) => message.id === id));
			if (missing.length > 0) {
				throw new NotFoundError('Message ' + missing.join(', ') + ' not found');
			}
			const chapterId = await AuthzService.activeChapterOf(req);
			if (!AuthzService.isAdmin(req)) {
				if (AuthzService.hasRole(req, AuthzService.CHAPTER) && !chapterId) {
					throw await AuthzService.groupRefusal(req);
				}
				const foreign = found.filter((m) => !chapterId || m.relayChapter !== chapterId);
				if (foreign.length > 0) {
					throw AuthzService.forbidden(
						'Only the relay group or an admin can change a letter status (letter ' +
							foreign.map((m) => m.id).join(', ') +
							').'
					);
				}
			}
			// In the order asked for, so that "the first letter that cannot move" means something.
			const letters = wanted.map((id) => found.find((message) => message.id === id));
			const moved = await Message.changeStatuses(letters, status, req.user.id, {
				reason,
				note,
				release
			});
			await audit(req, 'letter.status.batch', 'message', null, {
				to: status,
				count: moved.length,
				ids: moved.map((m) => m.id),
				...(status === RETURNED ? { reason } : {})
			});
			await this.#announceBatch(req, letters, status, status === RETURNED ? reason : undefined);
			this.#handleSuccess(res, { status, count: moved.length, ids: moved.map((m) => m.id) });
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** @throws {ValidationError} unless `ids` is 1 to BATCH_LIMIT different letter ids */
	static #batchIds(ids) {
		const clean = Array.isArray(ids) ? ids.map(Number) : [];
		if (
			clean.length === 0 ||
			clean.length > BATCH_LIMIT ||
			clean.some((id) => !Number.isSafeInteger(id) || id < 1) ||
			new Set(clean).size !== clean.length
		) {
			throw new ValidationError(
				'ids must be a list of 1 to ' + BATCH_LIMIT + ' different letter ids.'
			);
		}
		return clean;
	}

	/** One notification per writer, however many of their letters moved. */
	async #announceBatch(req, letters, status, reason) {
		const byWriter = new Map();
		for (const letter of letters) {
			byWriter.set(letter.user, [...(byWriter.get(letter.user) || []), letter]);
		}
		for (const [writer, theirs] of byWriter) {
			const chats = new Set(theirs.map((letter) => letter.chat));
			await notify(
				[writer],
				{
					event: 'letter.status',
					// Named when there is one to name; a client opens the thread or the letter.
					chat: chats.size === 1 ? theirs[0].chat : null,
					message: theirs.length === 1 ? theirs[0].id : null,
					detail: {
						status,
						...(reason ? { reason } : {}),
						...(theirs.length > 1
							? { count: theirs.length, messages: theirs.map((l) => l.id) }
							: {})
					}
				},
				{ actor: req.user.id }
			);
		}
	}

	/** Delete a message. Non-admins may only delete a letter that is still open. */
	async remove(req, res, next) {
		const { id } = req.body;
		try {
			const scope = await threadScope(req);
			const current = await this.#loadAllowed(scope, id);
			this.#requireOwnSide(scope, current);
			if (current && scope.kind !== 'all' && !isOpen(current.status)) {
				throw AuthzService.forbidden('A ' + current.status + ' letter can no longer be deleted.');
			}
			// The status is checked again by the DELETE itself: a letter the relay group
			// marks printed after the look above is not deleted.
			const openOnly = scope.kind !== 'all';
			const deletedRows = await Message.deleteMessage(id, { openOnly });
			if (deletedRows === 0 && openOnly && current) {
				const now = await Message.getMessageByID(id);
				if (now && !isOpen(now.status)) {
					throw AuthzService.forbidden('A ' + now.status + ' letter can no longer be deleted.');
				}
			}
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'Message ' + id));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}
}
