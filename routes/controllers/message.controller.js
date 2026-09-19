import Message from '#models/message.model.js';
import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { threadScope, resolveWriter } from '#rtServices/scope.services.js';
import ValidationError from '#services/ValidationError.js';
import { isOpen, LETTER_STATUSES } from '#db/letter-status.js';
import Attachment from '#models/attachment.model.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';
import { sniffType } from '#services/files.js';
import { audit } from '#rtServices/audit.services.js';
import { notify, membersOf } from '#rtServices/notify.services.js';
import LetterKey from '#models/letter-key.model.js';
import * as crypto from '#services/crypto.js';
import User from '#models/user.model.js';
import { retentionDefaultDays, retentionMaxDays } from '#constants';
import { windowFor } from '#db/retention.js';

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
		return filters;
	}

	/**
	 * List messages. Exactly one selector is applied, in precedence order: id,
	 * chat, prisoner, user; with none, everything in the caller's scope.
	 * `status` and `relayChapter` narrow any of those. Paginated with page
	 * and page_size.
	 */
	async getMany(req, res, next) {
		const { id, chat, prisoner, user, page, page_size } = req.query;
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
			const row =
				full === 'true' ? await Message.readLetter(id, AuthzService.publishedOnly(req)) : message;
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
		try {
			const scope = await threadScope(req);
			const sender = scope.kind === 'own' ? 'user' : req.body.sender;
			const user = await resolveWriter(req, scope, req.body.user, { sender, prisoner });
			const fields = { sender, prisoner, user, relayChapter };
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
			const message = await Message.createLetter(fields, {
				callerChapter: scope.chapterId || null,
				changedBy: req.user.id,
				envelopes: req.body.envelopes
			});
			await this.#withEnvelopes([message], req, scope);
			await this.#announce(req, message);
			this.#handleSuccess(res, message);
		} catch (err) {
			this.#fail(res, next, err);
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
			if (newMessage.relayChapter !== undefined) {
				const current = await Message.getMessageByID(newMessage.id);
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
		const { id, status } = req.body;
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
			const updated = await Message.changeStatus(message, status, req.user.id);
			await audit(req, 'letter.status', 'message', updated.id, { from, to: status });
			await notify(
				[updated.user],
				{
					event: 'letter.status',
					chat: updated.chat,
					message: updated.id,
					detail: { status: updated.status }
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
			const attachment = await Attachment.attach({
				message: message.id,
				buffer: req.file.buffer,
				mimeType,
				originalName: req.file.originalname,
				uploadedBy: req.user.id,
				nonce
			});
			this.#handleSuccess(res, attachment);
		} catch (err) {
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

	/** Delete a message. Non-admins may only delete a letter that is still open. */
	async remove(req, res, next) {
		const { id } = req.body;
		try {
			const scope = await threadScope(req);
			const current = await this.#loadAllowed(scope, id);
			if (current && scope.kind !== 'all' && !isOpen(current.status)) {
				throw AuthzService.forbidden('A ' + current.status + ' letter can no longer be deleted.');
			}
			const deletedRows = await Message.deleteMessage(id);
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'Message ' + id));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}
}
