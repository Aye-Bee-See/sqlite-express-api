import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Chat from '#models/chat.model.js';
import modelsService from '#models/models.service.js';

export default class User extends Model {
	static init(sequelize) {
		return super.init(Schemas.user, {
			sequelize,
			hooks: Hooks.user || null,
			modelName: 'User',
			tableName: 'User'
		});
	}

	static associate(models) {
		this.hasMany(models.Chat, { as: 'chats', foreignKey: 'userId' });
	}

	// Create

	static async createUser({ username, password, role, email, name, bio }) {
		//   const banned = false;
		return await this.create(
			{ username, password, role, email, name, bio },
			{ individualHooks: true }
		);
	}

	/**
	 *  create multiple users
	 *
	 *  @param {array} userArray  - Array of user params
	 */
	static async createBulkUsers(userArray) {
		return await this.bulkCreate(userArray, { individualHooks: true, ignoreDuplicates: true });
	}

	/**
	 * Get raw user count
	 * @returns {int}
	 */
	static async countUsers() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	static async getAllUsers(full, limit, offset = 0) {
		let filters = { limit, offset };
		let options;

		if (full) {
			options = {
				include: [
					{
						model: Chat,
						as: 'chats'
					}
				]
			};
		}
		filters = { ...filters, ...options };
		console.log(filters);

		return await User.findAll(filters);
	}

	static async getUsersByRole(role, full, limit, offset = 0) {
		const exists = await modelsService.modelInstanceExists('Role', role);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options;
		if (full) {
			options = {
				where: { role: role },
				include: [
					{
						model: 'Chat',
						as: 'chats'
					}
				]
			};
		} else {
			options = {
				where: { role: role }
			};
		}
		filters = { ...filters, ...options };
		return await User.findAll(filters);
	}

	static async getUser(obj, full) {
		if (full) {
			return await this.findOne({
				where: obj,
				include: [
					{
						model: Chat,
						as: 'chats'
					}
				]
			});
		} else {
			return await this.findOne({
				where: obj
			});
		}
	}
	static async getUserByID(id, full) {
		if (full) {
			return await this.findOne({
				where: { id: id },
				include: [
					{
						model: Chat,
						as: 'chats'
					}
				]
			});
		} else {
			return await this.findOne({
				where: { id: id }
			});
		}
	}
	static async getUserByEmail(email, full) {
		if (full) {
			return await this.findOne({
				where: { email: email },
				include: [
					{
						model: Chat,
						as: 'chats'
					}
				]
			});
		} else {
			return await this.findOne({
				where: { email: email }
			});
		}
	}
	static async getUserByUsername(username, full) {
		if (full) {
			return await this.findOne({
				where: { username: username },
				include: [
					{
						model: Chat,
						as: 'chats'
					}
				]
			});
		} else {
			return await this.findOne({
				where: { username: username }
			});
		}
	}

	static async getUserByUsernameOrEmail(username, email, full) {
		if (full) {
			return await this.findOne({
				where: { username: username, email: email },
				include: [
					{
						model: Chat,
						as: 'chats'
					}
				]
			});
		} else {
			return await this.findOne({
				where: { username: username, email: email }
			});
		}
	}

	// Update

	static async updateUser(user) {
		return await this.update({ ...user }, { where: { id: user.id } });
	}

	static async banUser(userId) {
		return await this.update({ role: 'banned' }, { where: { id: userId } });
	}

	// Delete

	static async deleteUser(id) {
		return await this.destroy({ where: { id: id } });
	}
}
