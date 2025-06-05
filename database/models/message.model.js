import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
//import Chat from '#models/chat.model.js';

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
		return await this.bulkCreate(messageArray, {
			validate: true,
			individualHooks: true
		});
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
	static async readAllMessages() {
		return await this.findAll();
	}

	static async readMessageById(id) {
		return await this.findAll({
			where: { id: id }
		});
	}

	static async readMessagesByChat(id) {
		return await this.findAll({
			where: { chat: id }
		});
	}

	static async readMessagesByPrisoner(id) {
		return await this.findAll({
			where: { prisoner: id }
		});
	}

	static async readMessagesByUser(id) {
		return await this.findAll({
			where: { user: id }
		});
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
