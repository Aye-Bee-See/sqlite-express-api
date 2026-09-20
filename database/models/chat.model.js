import { Model, Op, literal } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import pick, { updateById } from '#db/pick.js';
import Hooks from '#hooks/all.hooks.js';
import Message from '#models/message.model.js';
import Attachment from '#models/attachment.model.js';
import * as crypto from '#services/crypto.js';
import Prisoner from '#models/prisoner.model.js';
import User from '#models/user.model.js';
import Prison from '#models/prison.model.js';
import { publishedWhere } from '#db/record-status.js';
import modelsService from '#models/models.service.js';
import { inTransaction, createSerialQueue } from '#services/serial.js';
import { OPEN_STATUSES } from '#db/letter-status.js';

/** Correlated subquery: when the newest message in the chat was created. */
const LAST_MESSAGE_AT = literal(
	'(SELECT MAX(`createdAt`) FROM `Messages` WHERE `Messages`.`chat` = `Chat`.`id`)'
);

/**
 * List options shared by every chat list reader: expose `lastMessageAt` and
 * order most-recently-active first, with chats that have no messages last.
 */
function listOptions() {
	return {
		attributes: { include: [[LAST_MESSAGE_AT, 'lastMessageAt']] },
		order: [
			[literal('(' + LAST_MESSAGE_AT.val + ') IS NULL'), 'ASC'],
			[LAST_MESSAGE_AT, 'DESC'],
			['id', 'DESC']
		]
	};
}

const oneChatAtATime = createSerialQueue();

/**
 * What a thread says about its writer. Everyone who can read the thread sees
 * this (the writer, the group that mails it, the group that manages the
 * writer), so it is less than GET /auth/user gives any one of them: no email,
 * no manager's note, no session or retention settings.
 */
const WRITER_EMBED = [
	'id',
	'name',
	'username',
	'bio',
	'role',
	'chapterId',
	'managedBy',
	'claimedAt',
	'anonymousForChapter',
	'publicKey'
];

/** Non-staff only see published embedded records; the rest come back null. */
function visibility(publishedOnly) {
	return publishedOnly ? { where: publishedWhere(true), required: false } : {};
}

/** Light facility summary nested under a prisoner include (inbox rows). */
function facilitySummary(publishedOnly) {
	return {
		model: Prison,
		as: 'prison_details',
		attributes: ['id', 'prisonName', 'country'],
		...visibility(publishedOnly)
	};
}

/**
 * What every chat row carries without full=true: who the prisoner is and
 * where they are held, enough for an inbox line.
 */
function threadSummary(publishedOnly) {
	return [
		{
			model: Prisoner,
			as: 'prisoner_details',
			attributes: ['id', 'birthName', 'chosenName', 'status', 'prison'],
			...visibility(publishedOnly),
			include: [facilitySummary(publishedOnly)]
		}
	];
}

/** The relay group's id and name, on every message row. */
function relayGroupSummary(publishedOnly) {
	return { association: 'relay_group', attributes: ['id', 'name'], ...visibility(publishedOnly) };
}

export default class Chat extends Model {
	static init(sequelize) {
		return super.init(Schemas.chat, {
			sequelize,
			hooks: Hooks.chat || null,
			modelName: 'Chat'
		});
	}
	static associate(models) {
		this.belongsTo(models.Prisoner, {
			as: 'prisoner_details',
			foreignKey: 'prisoner',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'user_details',
			foreignKey: 'user',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.hasMany(models.Message, {
			as: 'messages',
			foreignKey: 'chat',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
	}

	// Create
	static async createChat({ user, prisoner }) {
		return await this.create({ user, prisoner });
	}

	/**
	 *  create multiple chats
	 *
	 *  @param {array} chatArray  - Array of chat params
	 */
	static async createBulkChats(chatArray) {
		return await this.bulkCreate(chatArray, { individualHooks: true, ignoreDuplicates: true });
	}

	/**
	 * Get raw chat count
	 * @returns {int}
	 */
	static async countChats() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	// Read

	static async readAllChats(full, limit, offset = 0, extraWhere = {}, publishedOnly = false) {
		let filters = { limit, offset, where: { ...extraWhere } };
		let options = { include: threadSummary(publishedOnly) };
		if (full) {
			options = {
				include: [
					{ model: Message, as: 'messages', include: [relayGroupSummary(publishedOnly)] },
					{
						model: User,
						as: 'user_details',
						attributes: WRITER_EMBED
					},
					{
						model: Prisoner,
						as: 'prisoner_details',
						...Prisoner.publicAttributes(publishedOnly),
						...visibility(publishedOnly),
						include: [facilitySummary(publishedOnly)]
					}
				]
			};
		}
		filters = { ...filters, ...options, where: { ...extraWhere } };
		return await Chat.findAndCountAll({ ...filters, ...listOptions(), distinct: true });
	}

	/**
	 * Get a single chat by primary key, without associations.
	 * @param {number|string} id
	 * @returns {Promise<Chat|null>}
	 */
	static async getChatByID(id) {
		return await this.findByPk(id);
	}

	/**
	 * @param {number|string} id user id
	 * @param {boolean} full include messages and user/prisoner details
	 * @param {number} limit
	 * @param {number} offset
	 * @param {object} extraWhere additional column filters merged into the where clause
	 */
	static async readChatsByUser(
		id,
		full,
		limit,
		offset = 0,
		extraWhere = {},
		publishedOnly = false
	) {
		const exists = await modelsService.modelInstanceExists('User', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = { where: { ...extraWhere, user: id }, include: threadSummary(publishedOnly) };
		if (full) {
			options = {
				where: { ...extraWhere, user: id },
				include: [
					{ model: Message, as: 'messages', include: [relayGroupSummary(publishedOnly)] },
					{
						model: User,
						as: 'user_details',
						attributes: WRITER_EMBED
					},
					{
						model: Prisoner,
						as: 'prisoner_details',
						...Prisoner.publicAttributes(publishedOnly),
						...visibility(publishedOnly),
						include: [facilitySummary(publishedOnly)]
					}
				]
			};
		}
		filters = { ...filters, ...options };
		return await Chat.findAndCountAll({ ...filters, ...listOptions(), distinct: true });
	}

	static async readChatsByPrisoner(
		id,
		full,
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
		let options = { where: { prisoner: id, ...extraWhere }, include: threadSummary(publishedOnly) };
		if (full) {
			options = {
				where: { prisoner: id, ...extraWhere },
				include: [
					{ model: Message, as: 'messages', include: [relayGroupSummary(publishedOnly)] },
					{
						model: User,
						as: 'user_details',
						attributes: WRITER_EMBED
					},
					{
						model: Prisoner,
						as: 'prisoner_details',
						...Prisoner.publicAttributes(publishedOnly),
						...visibility(publishedOnly),
						include: [facilitySummary(publishedOnly)]
					}
				]
			};
		}
		filters = { ...filters, ...options };
		return await Chat.findAndCountAll({ ...filters, ...listOptions(), distinct: true });
	}

	static async readChatByUserAndPrisoner(user, prisoner, full, publishedOnly = false) {
		if (full) {
			return await this.findOne({
				where: { user: user, prisoner: prisoner },
				include: [
					{ model: Message, as: 'messages', include: [relayGroupSummary(publishedOnly)] },
					{
						model: User,
						as: 'user_details',
						attributes: WRITER_EMBED
					},
					{
						model: Prisoner,
						as: 'prisoner_details',
						...Prisoner.publicAttributes(publishedOnly),
						...visibility(publishedOnly),
						include: [facilitySummary(publishedOnly)]
					}
				]
			});
		} else {
			return await this.findOne({
				where: { user: user, prisoner: prisoner },
				include: threadSummary(publishedOnly)
			});
		}
	}

	/**
	 * Get one chat by id.
	 * @param {number|string} id
	 * @param {boolean} full include messages and user/prisoner details
	 * @returns {Promise<Chat|null>}
	 */
	static async readChatById(id, full, publishedOnly = false) {
		if (full) {
			return await this.findOne({
				where: { id: id },
				include: [
					{ model: Message, as: 'messages', include: [relayGroupSummary(publishedOnly)] },
					{
						model: User,
						as: 'user_details',
						attributes: WRITER_EMBED
					},
					{
						model: Prisoner,
						as: 'prisoner_details',
						...Prisoner.publicAttributes(publishedOnly),
						...visibility(publishedOnly),
						include: [facilitySummary(publishedOnly)]
					}
				]
			});
		} else {
			return await this.findOne({ where: { id: id }, include: threadSummary(publishedOnly) });
		}
	}

	/**
	 * Attach `last_message` (id, sender, messageText, createdAt, or null) and
	 * normalise `lastMessageAt` to an ISO timestamp on each chat row in place,
	 * with one extra query for the whole page.
	 * @param {Chat[]} chats
	 * @returns {Promise<Chat[]>} the same rows
	 */
	static async attachLastMessages(chats) {
		if (chats.length === 0) {
			return chats;
		}
		// Only the newest letter of each thread is loaded (and, in server mode,
		// decrypted). Loading every letter of every thread on the page to pick one
		// cost a page of long threads thousands of rows and decryptions.
		const [newest] = await this.sequelize.query(
			`SELECT m.id AS id FROM Messages AS m
			WHERE m.chat IN (:chats)
				AND m.id = (
					SELECT id FROM Messages WHERE chat = m.chat ORDER BY createdAt DESC, id DESC LIMIT 1
				)`,
			{ replacements: { chats: chats.map((c) => c.id) } }
		);
		const messages =
			newest.length === 0
				? []
				: await Message.findAll({ where: { id: newest.map((row) => row.id) } });
		const latest = new Map(messages.map((m) => [m.chat, m]));
		for (const chat of chats) {
			const m = latest.get(chat.id);
			// The ordering subquery yields SQLite's raw text; expose the same instant as an ISO date.
			chat.setDataValue('lastMessageAt', m ? m.createdAt : null);
			chat.setDataValue(
				'last_message',
				m
					? {
							id: m.id,
							sender: m.sender,
							messageText: m.messageText,
							...(crypto.isE2E()
								? {
										ciphertext: m.getDataValue('ciphertext'),
										nonce: m.getDataValue('nonce'),
										relayNoteCiphertext: m.getDataValue('relayNoteCiphertext'),
										relayNoteNonce: m.getDataValue('relayNoteNonce')
									}
								: {}),
							status: m.status,
							createdAt: m.createdAt
						}
					: null
			);
		}
		return chats;
	}

	/**
	 * The thread of a writer and a prisoner, made if there is none.
	 * @returns {Promise<[Chat, boolean]>} the chat, and whether it was made now
	 *
	 * One at a time in this process, and without a database transaction.
	 * Sequelize's findOrCreate opens one of its own, and this runs in a hook on
	 * every letter: forty letters saved together were forty transactions
	 * competing for SQLite's one write lock, and on an in-memory database (one
	 * connection) a second BEGIN simply fails. The queue is what keeps two
	 * letters sent together from making two threads.
	 */
	static async findOrCreateChat(user, prisoner) {
		return await oneChatAtATime(async () => {
			const existing = await this.findOne({
				where: { user: user, prisoner: prisoner },
				order: [['id', 'ASC']]
			});
			if (existing) {
				return [existing, false];
			}
			return [await this.create({ user: user, prisoner: prisoner }), true];
		});
	}

	// Update

	/**
	 * Update a chat by id. Foreign-key constraints reject a user or prisoner
	 * that does not exist.
	 * @param {object} chat fields to change, including `id`
	 * @returns {Promise<[number]>} affected row count
	 */
	static async updateChat(chat) {
		return await updateById(this, chat.id, pick(chat, ['user', 'prisoner']));
	}

	// Delete

	/**
	 * Delete a chat with its messages and their attachment files.
	 * @param {number|string} id
	 * @param {{openOnly?: boolean}} [options] openOnly: refuse when a letter in it was
	 *   printed or mailed. Checked inside the transaction that deletes, so a letter
	 *   marked printed a moment after the caller looked still stops it.
	 * @returns {Promise<{deleted: number, kept: number}>} chats removed; letters that stopped it
	 */
	static async deleteChat(id, { openOnly = false } = {}) {
		let files = [];
		const result = await inTransaction(this.sequelize, async (transaction) => {
			if (openOnly) {
				const kept = await Message.count({
					where: { chat: id, status: { [Op.notIn]: OPEN_STATUSES } },
					transaction
				});
				if (kept > 0) {
					return { deleted: 0, kept };
				}
			}
			const messages = await Message.findAll({
				where: { chat: id },
				attributes: ['id'],
				hooks: false,
				transaction
			});
			// Listed now (the cascade removes the rows), removed from disk after the commit.
			files = await Attachment.storedNamesFor(
				messages.map((m) => m.id),
				{ transaction }
			);
			await Message.destroy({ where: { chat: id }, transaction });
			return { deleted: await this.destroy({ where: { id: id }, transaction }), kept: 0 };
		});
		if (result.deleted > 0) {
			await Attachment.removeFiles(files);
		}
		return result;
	}
}
