import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import modelsService from '#models/models.service.js';

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
	static async createMessage(messageText, sender) {
		return await this.create(messageText, sender);
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

	static async updateMessage(message) {
		return await this.update({ ...message }, { where: { id: message.id } });
	}

	// Delete

	static async deleteMessage(id) {
		return await this.destroy({
			where: { id: id },
			force: true
		});
	}
}
