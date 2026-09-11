import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import modelsService from '#models/models.service.js';
import Chat from '#models/chat.model.js';

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
		// this.belongsTo(models.Prisoner, { through: "Chat", foreignKey: 'prisoner', sourceKey: 'id' });
		// this.belongsTo(models.User, { through: "Chat", foreignKey: 'user', sourceKey: 'id' });
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
	static async readAllMessages(limit, offset = 0, extraWhere = {}) {
		let filters = { limit, offset, where: { ...extraWhere } };
		return await Message.findAll(filters);
	}

	/**
	 * Get a single message by primary key.
	 * @param {number|string} id
	 * @returns {Promise<Message|null>}
	 */
	static async getMessageByID(id) {
		return await this.findByPk(id);
	}

	static async readMessageById(id, limit, offset = 0, extraWhere = {}) {
		let filters = { limit, offset };
		let options = {
			where: { id: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAll(filters);
	}

	static async readMessagesByChat(id, limit, offset = 0, extraWhere = {}) {
		const exists = await modelsService.modelInstanceExists('Chat', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { chat: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAll(filters);
	}

	static async readMessagesByPrisoner(id, limit, offset = 0, extraWhere = {}) {
		const exists = await modelsService.modelInstanceExists('Prisoner', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { prisoner: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAll(filters);
	}

	static async readMessagesByUser(id, limit, offset = 0, extraWhere = {}) {
		const exists = await modelsService.modelInstanceExists('User', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { user: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAll(filters);
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
		const values = { ...message };
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
		return await this.update(values, { where: { id: message.id } });
	}

	// Delete

	static async deleteMessage(id) {
		return await this.destroy({
			where: { id: id },
			force: true
		});
	}
}
