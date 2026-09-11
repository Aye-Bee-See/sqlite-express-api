import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Message from '#models/message.model.js';
import Prisoner from '#models/prisoner.model.js';
import User from '#models/user.model.js';
import modelsService from '#models/models.service.js';

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

	static async readAllChats(full, limit, offset = 0) {
		let filters = { limit, offset };
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
		filters = { ...filters, ...options };
		return await Chat.findAndCountAll({ ...filters, distinct: true, order: [['id', 'ASC']] });
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
		return await Chat.findAndCountAll({ ...filters, distinct: true, order: [['id', 'ASC']] });
	}

	static async readChatsByPrisoner(id, full, limit, offset = 0) {
		const exists = await modelsService.modelInstanceExists('Prisoner', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { prisoner: id }
		};
		if (full) {
			options = {
				where: { prisoner: id },
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
		return await Chat.findAndCountAll({ ...filters, distinct: true, order: [['id', 'ASC']] });
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

	static async deleteChat(id) {
		var destroyedChats = 0;
		await Message.destroy({
			where: {
				chat: id
			}
		}).then(
			await this.destroy({ where: { id: id } }).then((dc) => {
				destroyedChats = dc;
			})
		);
		return destroyedChats;
	}
}
