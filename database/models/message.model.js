import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import pick from '#db/pick.js';
import Hooks from '#hooks/all.hooks.js';
import modelsService from '#models/models.service.js';
import Chat from '#models/chat.model.js';
import MessageStatus from '#models/message-status.model.js';
import Attachment from '#models/attachment.model.js';
import LetterKey from '#models/letter-key.model.js';
import User from '#models/user.model.js';
import * as crypto from '#services/crypto.js';
import { publishedWhere } from '#db/record-status.js';
import Prisoner from '#models/prisoner.model.js';
import Chapter from '#models/chapter.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';
import {
	canTransition,
	initialStatusFor,
	LETTER_STATUSES,
	OPEN_STATUSES
} from '#db/letter-status.js';

/** What PUT /messaging/message may change. The thread follows from writer and prisoner; status has its own endpoint. */
const EDITABLE = ['messageText', 'relayNote', 'user', 'prisoner', 'relayChapter', 'keep'];
/** Written by clients in end-to-end mode only; in server mode the API fills them. */
const CIPHER_COLUMNS = ['ciphertext', 'nonce', 'relayNoteCiphertext', 'relayNoteNonce'];

/** The relay group's id and name, carried on every message row (null for non-staff when unpublished). */
function relayGroupSummary(publishedOnly) {
	return {
		association: 'relay_group',
		attributes: ['id', 'name'],
		...(publishedOnly ? { where: publishedWhere(true), required: false } : {})
	};
}

function staleKeyError(chapterIds) {
	return new HttpError(
		409,
		'Chapter ' +
			chapterIds.join(', ') +
			' rotated its key while this was being saved; fetch its public key again and re-seal.',
		'KeyVersionError'
	);
}

export default class Message extends Model {
	static init(sequelize) {
		return super.init(Schemas.message, {
			sequelize,
			hooks: Hooks.message || null,
			modelName: 'Message'
		});
	}
	static associate(models) {
		this.belongsTo(models.Chat, {
			as: 'chat_details',
			foreignKey: 'chat',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'user_details',
			foreignKey: 'user',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Prisoner, {
			as: 'prisoner_details',
			foreignKey: 'prisoner',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Chapter, {
			as: 'relay_group',
			foreignKey: 'relayChapter',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'status_changed_by',
			foreignKey: 'statusChangedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.hasMany(models.MessageStatus, {
			as: 'status_history',
			foreignKey: 'message',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.hasMany(models.Attachment, {
			as: 'attachments',
			foreignKey: 'message',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
	}

	// Letter lifecycle

	/**
	 * Decide which group mails a letter. An explicit `requested` group must be
	 * one of the facility's relay groups. Otherwise: the caller's own group if
	 * it relays for that facility, else the facility's only relay group, else
	 * none (refused when the facility is relay_only).
	 * @param {number|string} prisonerId
	 * @param {number|string|null|undefined} requested `relayChapter` from the body
	 * @param {number|null} callerChapter the caller's group, for chapter-role callers
	 * @returns {Promise<number|null>}
	 * @throws {ValidationError}
	 */
	static async resolveRelayChapter(prisonerId, requested, callerChapter = null) {
		const prisoner = await Prisoner.findByPk(prisonerId);
		if (!prisoner) {
			// The foreign key reports the missing prisoner; nothing to route.
			return requested ?? null;
		}
		const { prison, relayIds } = await Prisoner.relayGroupsFor(prisoner);
		if (requested !== undefined && requested !== null && requested !== '') {
			if (!relayIds.includes(Number(requested))) {
				throw new ValidationError(
					'Relay group ' + requested + ' does not relay mail for this facility.'
				);
			}
			return Number(requested);
		}
		if (callerChapter && relayIds.includes(callerChapter)) {
			return callerChapter;
		}
		if (relayIds.length === 1) {
			return relayIds[0];
		}
		if (prison && prison.routing === 'relay_only') {
			throw new ValidationError(
				relayIds.length === 0
					? 'This facility only accepts relayed mail and has no relay group yet.'
					: 'This facility only accepts relayed mail; choose a relay group (relayChapter).'
			);
		}
		return null;
	}

	/**
	 * Create a letter or reply with its relay group resolved and the first
	 * history row written.
	 * @param {object} message fields for createMessage
	 * @param {{callerChapter?: number|null, changedBy?: number|null}} context
	 */
	static async createLetter(message, { callerChapter = null, changedBy = null, envelopes } = {}) {
		const relayChapter = await this.resolveRelayChapter(
			message.prisoner,
			message.relayChapter,
			callerChapter
		);
		const status = initialStatusFor(message.sender);
		let clean = null;
		if (crypto.isE2E()) {
			if (message.messageText !== undefined || message.relayNote !== undefined) {
				throw new ValidationError(
					'End-to-end mode: send ciphertext and nonce, not messageText or relayNote.'
				);
			}
			Message.requireCipherPairs(message, { bodyRequired: true });
			const writer = await User.findByPk(message.user);
			if (!writer) {
				throw new ValidationError('User ' + message.user + ' does not exist.');
			}
			const allowed = await this.allowedReaders(
				{ prisoner: message.prisoner, relayChapter },
				writer
			);
			clean = LetterKey.validateEnvelopes(envelopes, allowed, { writer, relayChapter });
		}
		const created = await this.create({
			...message,
			relayChapter,
			status,
			statusChangedAt: new Date(),
			statusChangedBy: changedBy
		});
		try {
			return await this.#finishLetter(created, clean, changedBy);
		} catch (err) {
			// A letter is all there or not there: a row left behind by a failure here
			// would be mailed without its envelopes or history, and a retry under the
			// same Idempotency-Key would make a second one beside it.
			await LetterKey.destroy({ where: { message: created.id } }).catch(() => {});
			await this.destroy({ where: { id: created.id }, force: true }).catch(() => {});
			throw err;
		}
	}

	static async #finishLetter(created, clean, changedBy) {
		if (clean) {
			await LetterKey.issueEnvelopes(created.id, clean);
			// A rotation that landed since validation would leave this letter sealed to a
			// key nobody holds: createLetter takes it back, and the client re-seals.
			const stale = await LetterKey.staleGroupEnvelopes(created.id);
			if (stale.length > 0) {
				throw staleKeyError(stale);
			}
		}
		await MessageStatus.record(created.id, null, created.status, changedBy);
		return created;
	}

	/**
	 * e2e: ciphertext and nonce travel as pairs (body and relay note), and a
	 * pair is either absent or two non-empty strings.
	 * @throws {ValidationError}
	 */
	static requireCipherPairs(fields, { bodyRequired }) {
		const pair = (a, b, label, required) => {
			const given = [fields[a], fields[b]].filter((v) => v !== undefined);
			if (given.length === 0) {
				if (required) {
					throw new ValidationError('End-to-end mode: ' + a + ' and ' + b + ' are required.');
				}
				return;
			}
			const ok =
				given.length === 2 && given.every((v) => (typeof v === 'string' && v !== '') || v === null);
			const bothNull = fields[a] === null && fields[b] === null;
			if (!ok || (bothNull && required) || (fields[a] === null) !== (fields[b] === null)) {
				throw new ValidationError(
					'End-to-end mode: send ' +
						a +
						' and ' +
						b +
						' together' +
						(label ? ' for the ' + label : '') +
						'.'
				);
			}
		};
		pair('ciphertext', 'nonce', 'body', bodyRequired);
		pair('relayNoteCiphertext', 'relayNoteNonce', 'relay note', false);
	}

	/**
	 * Who may hold an envelope for a letter: its writer; the relay group;
	 * the group managing the writer; and every active relay group of the
	 * facility (so a relay can forward to a partner).
	 * @returns {Promise<{users: Set<number>, chapters: Set<number>, chapterVersions: Map<number, number>}>}
	 */
	static async allowedReaders(message, writer) {
		const users = new Set([Number(writer.id)]);
		const chapters = new Set();
		if (message.relayChapter) {
			chapters.add(Number(message.relayChapter));
		}
		if (writer.managedBy) {
			chapters.add(Number(writer.managedBy));
		}
		const prisoner = await Prisoner.findByPk(message.prisoner);
		if (prisoner) {
			const { relayIds } = await Prisoner.relayGroupsFor(prisoner);
			for (const id of relayIds) {
				chapters.add(Number(id));
			}
		}
		const keyed = await Chapter.findAll({
			where: { id: [...chapters] },
			attributes: ['id', 'keyVersion']
		});
		const chapterVersions = new Map(keyed.map((c) => [c.id, c.keyVersion]));
		return { users, chapters, chapterVersions };
	}

	/**
	 * e2e: add an envelope for one more reader (forwarding to a partner group).
	 * @throws {ValidationError} for a reader the letter may not have; 409 when it already exists
	 */
	static async addEnvelope(message, envelope) {
		const writer = await User.findByPk(message.user);
		const allowed = await this.allowedReaders(message, writer);
		const [clean] = LetterKey.validateEnvelopes([envelope], allowed, {
			writer: { ...writer.get(), anonymousForChapter: true },
			relayChapter: null
		});
		const existing = await LetterKey.findOne({
			where: { message: message.id, readerType: clean.readerType, readerId: clean.readerId }
		});
		if (existing) {
			throw new HttpError(
				409,
				'Reader ' + clean.readerType + ' ' + clean.readerId + ' already has an envelope.',
				'EnvelopeError'
			);
		}
		const [row] = await LetterKey.issueEnvelopes(message.id, [clean]);
		if (clean.readerType === 'chapter') {
			const stale = await LetterKey.staleGroupEnvelopes(message.id);
			if (stale.includes(clean.readerId)) {
				await row.destroy();
				throw staleKeyError([clean.readerId]);
			}
		}
		return clean;
	}

	/**
	 * Move a letter along its lifecycle (queued -> printed -> mailed).
	 * @param {Message} message
	 * @param {string} status the target status
	 * @param {number|null} changedBy
	 * @returns {Promise<Message>} the updated message with its history
	 * @throws {ValidationError} unknown status; {HttpError} 409 for a move the lifecycle does not allow
	 */
	static async changeStatus(message, status, changedBy = null) {
		if (!LETTER_STATUSES.includes(status)) {
			throw new ValidationError('Status must be one of ' + LETTER_STATUSES.join(', ') + '.');
		}
		if (!canTransition(message.status, status)) {
			throw new HttpError(
				409,
				'A ' + message.status + ' letter cannot move to ' + status + '.',
				'LetterStatusError'
			);
		}
		const from = message.status;
		await message.update({ status, statusChangedAt: new Date(), statusChangedBy: changedBy });
		await MessageStatus.record(message.id, from, status, changedBy);
		return await this.readLetter(message.id);
	}

	/** One message with its relay group, status history, and attachments embedded. */
	static async readLetter(id, publishedOnly = false) {
		return await this.findByPk(id, {
			include: [
				{ model: MessageStatus, as: 'status_history' },
				{ model: Attachment, as: 'attachments' },
				relayGroupSummary(publishedOnly)
			],
			order: [
				[{ model: MessageStatus, as: 'status_history' }, 'id', 'ASC'],
				[{ model: Attachment, as: 'attachments' }, 'id', 'ASC']
			]
		});
	}

	//  Create
	/**
	 * @param {{messageText: string, sender: string, user: number, prisoner: number}} message
	 * The chat is resolved by the beforeValidate hook.
	 */
	static async createMessage(message) {
		return await this.create(message);
	}

	/**
	 *  create multiple message
	 *
	 *  @param {array} messageArray  - Array of message params
	 */
	static async createBulkMessages(messageArray) {
		return await this.bulkCreate(messageArray, { validate: true, individualHooks: true });
	}

	/**
	 * Get raw message count
	 * @returns {int}
	 */
	static async countMessages() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	// Read
	static async readAllMessages(limit, offset = 0, extraWhere = {}, publishedOnly = false) {
		let filters = { limit, offset, where: { ...extraWhere } };
		return await Message.findAndCountAll({
			...filters,
			include: [relayGroupSummary(publishedOnly)],
			order: [['id', 'ASC']]
		});
	}

	/**
	 * Get a single message by primary key.
	 * @param {number|string} id
	 * @returns {Promise<Message|null>}
	 */
	static async getMessageByID(id, publishedOnly = false) {
		return await this.findByPk(id, { include: [relayGroupSummary(publishedOnly)] });
	}

	static async readMessageById(id, limit, offset = 0, extraWhere = {}, publishedOnly = false) {
		let filters = { limit, offset };
		let options = {
			where: { id: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAndCountAll({
			...filters,
			include: [relayGroupSummary(publishedOnly)],
			order: [['id', 'ASC']]
		});
	}

	static async readMessagesByChat(id, limit, offset = 0, extraWhere = {}, publishedOnly = false) {
		const exists = await modelsService.modelInstanceExists('Chat', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { chat: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAndCountAll({
			...filters,
			include: [relayGroupSummary(publishedOnly)],
			order: [['id', 'ASC']]
		});
	}

	static async readMessagesByPrisoner(
		id,
		limit,
		offset = 0,
		extraWhere = {},
		publishedOnly = false
	) {
		const exists = await modelsService.modelInstanceExists('Prisoner', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { prisoner: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAndCountAll({
			...filters,
			include: [relayGroupSummary(publishedOnly)],
			order: [['id', 'ASC']]
		});
	}

	static async readMessagesByUser(id, limit, offset = 0, extraWhere = {}, publishedOnly = false) {
		const exists = await modelsService.modelInstanceExists('User', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { user: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAndCountAll({
			...filters,
			include: [relayGroupSummary(publishedOnly)],
			order: [['id', 'ASC']]
		});
	}

	// Update

	/**
	 * Update a message by id. If the user or prisoner changes, the message is
	 * moved to the chat for the resulting pair (created if needed). The
	 * beforeValidate hook cannot do this for static updates because Sequelize
	 * discards attribute changes made during validation.
	 * @param {object} message fields to change, including `id`
	 * @returns {Promise<[number]>} affected row count
	 */
	static async updateMessage(message) {
		// Only what an edit may touch: never the thread (derived below), the
		// sender, the status, or the dates. Server mode owns the cipher columns.
		const values = pick(message, crypto.isE2E() ? [...EDITABLE, ...CIPHER_COLUMNS] : EDITABLE);
		if (crypto.isE2E()) {
			if (values.messageText !== undefined || values.relayNote !== undefined) {
				throw new ValidationError(
					'End-to-end mode: send ciphertext and nonce, not messageText or relayNote.'
				);
			}
			// The reader set is fixed by the envelopes; moving a letter would strand them.
			const current = await this.findByPk(message.id);
			for (const field of ['user', 'prisoner', 'relayChapter']) {
				if (values[field] === undefined) {
					continue;
				}
				if (current && String(values[field]) !== String(current[field])) {
					throw new ValidationError(
						'End-to-end mode: ' +
							field +
							' cannot change; add a reader with POST /messaging/envelope.'
					);
				}
				delete values[field];
			}
			Message.requireCipherPairs(values, { bodyRequired: false });
		}
		if (values.messageText !== undefined || values.relayNote !== undefined) {
			// Static updates skip instance hooks, so re-encrypt here with the letter's key.
			const key = await LetterKey.contentKeyFor(message.id);
			const columns = LetterKey.encryptFields(key, {
				messageText: values.messageText,
				relayNote: values.relayNote
			});
			delete values.messageText;
			delete values.relayNote;
			Object.assign(values, columns);
		}
		if (values.user !== undefined || values.prisoner !== undefined) {
			const current = await this.findByPk(message.id);
			if (current) {
				const user = values.user ?? current.user;
				const prisoner = values.prisoner ?? current.prisoner;
				if (user !== null && prisoner !== null) {
					const [chat] = await Chat.findOrCreateChat(user, prisoner);
					values.chat = chat.id;
				}
			}
		}
		if (Object.keys(values).length === 0) {
			// Nothing editable was sent: report whether the letter exists, change nothing.
			return [await this.count({ where: { id: message.id } })];
		}
		return await this.update(values, { where: { id: message.id } });
	}

	// Delete

	/**
	 * Delete a letter with its attachment files.
	 * @param {number|string} id
	 * @param {{openOnly?: boolean}} [options] openOnly: only while nothing was printed. The
	 *   status is part of the DELETE itself, so a letter marked printed a moment
	 *   after the caller looked is not deleted.
	 * @returns {Promise<number>} letters removed
	 */
	static async deleteMessage(id, { openOnly = false } = {}) {
		// Files are listed first (the cascade removes their rows) and removed only
		// if the letter really went.
		const files = await Attachment.storedNamesFor([Number(id)]);
		const deleted = await this.destroy({
			where: { id: id, ...(openOnly ? { status: OPEN_STATUSES } : {}) },
			force: true
		});
		if (deleted > 0) {
			await Attachment.removeFiles(files);
		}
		return deleted;
	}
}
