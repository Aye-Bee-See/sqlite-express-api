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
		this.belongsTo(models.Chat, { as: 'chat_details', foreignKey: 'chatId' });
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
	static async readAllMessages(limit, offset = 0) {
		let filters = { limit, offset };
		return await Message.findAll(filters);
	}

	static async readMessageById(id, limit, offset = 0) {
		let filters = { limit, offset };
		let options = {
			where: { id: id }
		};
		filters = { ...filters, ...options };
		return await Message.findAll(filters);
	}

	static async readMessagesByChat(id, limit, offset = 0) {
		const exists = await modelsService.modelInstanceExists('Chat', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { chat: id }
		};
		filters = { ...filters, ...options };
		return await Message.findAll(filters);
	}

	static async readMessagesByPrisoner(id, limit, offset = 0) {
		const exists = await modelsService.modelInstanceExists('Prisoner', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { prisoner: id }
		};
		filters = { ...filters, ...options };
		return await Message.findAll(filters);
	}

	static async readMessagesByUser(id, limit, offset = 0) {
		const exists = await modelsService.modelInstanceExists('User', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { user: id }
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
