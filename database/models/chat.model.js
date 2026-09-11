import { Model, literal } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Message from '#models/message.model.js';
import Attachment from '#models/attachment.model.js';
import Prisoner from '#models/prisoner.model.js';
import User from '#models/user.model.js';
import modelsService from '#models/models.service.js';

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

	static async readAllChats(full, limit, offset = 0, extraWhere = {}) {
		let filters = { limit, offset, where: { ...extraWhere } };
		let options;
		if (full) {
			options = {
				include: [
					{
						model: Message,
						as: 'messages'
					},
					{
						model: User,
						as: 'user_details'
					},
					{
						model: Prisoner,
						as: 'prisoner_details'
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
	static async readChatsByUser(id, full, limit, offset = 0, extraWhere = {}) {
		const exists = await modelsService.modelInstanceExists('User', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { ...extraWhere, user: id }
		};
		if (full) {
			options = {
				where: { ...extraWhere, user: id },
				include: [
					{
						model: Message,
						as: 'messages'
					},
					{
						model: User,
						as: 'user_details'
					},
					{
						model: Prisoner,
						as: 'prisoner_details'
					}
				]
			};
		}
		filters = { ...filters, ...options };
		return await Chat.findAndCountAll({ ...filters, ...listOptions(), distinct: true });
	}

	static async readChatsByPrisoner(id, full, limit, offset = 0, extraWhere = {}) {
		const exists = await modelsService.modelInstanceExists('Prisoner', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { prisoner: id, ...extraWhere }
		};
		if (full) {
			options = {
				where: { prisoner: id, ...extraWhere },
				include: [
					{
						model: Message,
						as: 'messages'
					},
					{
						model: User,
						as: 'user_details'
					},
					{
						model: Prisoner,
						as: 'prisoner_details'
					}
				]
			};
		}
		filters = { ...filters, ...options };
		return await Chat.findAndCountAll({ ...filters, ...listOptions(), distinct: true });
	}

	static async readChatByUserAndPrisoner(user, prisoner, full) {
		if (full) {
			return await this.findOne({
				where: { user: user, prisoner: prisoner },
				include: [
					{
						model: Message,
						as: 'messages'
					},
					{
						model: User,
						as: 'user_details'
					},
					{
						model: Prisoner,
						as: 'prisoner_details'
					}
				]
			});
		} else {
			return await this.findOne({
				where: { user: user, prisoner: prisoner }
			});
		}
	}

	/**
	 * Get one chat by id.
	 * @param {number|string} id
	 * @param {boolean} full include messages and user/prisoner details
	 * @returns {Promise<Chat|null>}
	 */
	static async readChatById(id, full) {
		if (full) {
			return await this.findOne({
				where: { id: id },
				include: [
					{
						model: Message,
						as: 'messages'
					},
					{
						model: User,
						as: 'user_details'
					},
					{
						model: Prisoner,
						as: 'prisoner_details'
					}
				]
			});
		} else {
			return await this.findOne({
				where: { id: id }
			});
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
		const messages = await Message.findAll({
			where: { chat: chats.map((c) => c.id) },
			order: [
				['createdAt', 'DESC'],
				['id', 'DESC']
			]
		});
		const latest = new Map();
		for (const m of messages) {
			if (!latest.has(m.chat)) {
				latest.set(m.chat, m);
			}
		}
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
							status: m.status,
							createdAt: m.createdAt
						}
					: null
			);
		}
		return chats;
	}

	static async findOrCreateChat(user, prisoner) {
		return await this.findOrCreate({
			where: { user: user, prisoner: prisoner },
			defaults: { user: user, prisoner: prisoner },
			paranoid: false
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
		return await this.update({ ...chat }, { where: { id: chat.id } });
	}

	// Delete

	/**
	 * Delete a chat with its messages and their attachment files.
	 * @returns {Promise<number>} chats removed
	 */
	static async deleteChat(id) {
		const messages = await Message.findAll({ where: { chat: id }, attributes: ['id'] });
		await Attachment.purgeForMessages(messages.map((m) => m.id));
		await Message.destroy({ where: { chat: id } });
		return await this.destroy({ where: { id: id } });
	}
}
