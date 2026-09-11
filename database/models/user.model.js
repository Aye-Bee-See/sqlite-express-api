import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Chat from '#models/chat.model.js';
import ValidationError from '#services/ValidationError.js';

export default class User extends Model {
	static init(sequelize) {
		return super.init(Schemas.user, {
			sequelize,
			hooks: Hooks.user || null,
			modelName: 'User',
			tableName: 'User',
			// Never select the password hash unless a caller opts in with
			// User.scope('withPassword'). This also covers every include of User
			// from other models (chat.user_details and so on).
			defaultScope: { attributes: { exclude: ['password'] } },
			scopes: { withPassword: { attributes: { include: ['password'] } } }
		});
	}

	static associate(models) {
		this.hasMany(models.Chat, {
			as: 'chats',
			foreignKey: 'user',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.hasMany(models.Message, {
			as: 'messages',
			foreignKey: 'user',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
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

		return await User.findAndCountAll({ ...filters, distinct: true, order: [['id', 'ASC']] });
	}

	/**
	 * List users holding one role.
	 * @param {string} role one of the roles allowed by the schema (case-insensitive)
	 * @param {boolean} full include each user's chats
	 * @param {number} limit
	 * @param {number} offset
	 * @throws {Error} when the role is not one the schema allows
	 */
	static async getUsersByRole(role, full, limit, offset = 0) {
		const allowedRoles = Schemas.user.role.validate.isIn.args[0];
		const normalizedRole = typeof role === 'string' ? role.toLowerCase() : role;
		if (!allowedRoles.includes(normalizedRole)) {
			throw new ValidationError(
				'Unknown role "' + role + '". Expected one of: ' + allowedRoles.join(', ') + '.'
			);
		}
		let filters = { limit, offset, where: { role: normalizedRole } };
		if (full) {
			filters.include = [
				{
					model: Chat,
					as: 'chats'
				}
			];
		}
		return await User.findAndCountAll({ ...filters, distinct: true, order: [['id', 'ASC']] });
	}

	/**
	 * Look up a user including the password hash, for credential checks only.
	 * @param {object} where column filters, e.g. { username }
	 * @returns {Promise<User|null>}
	 */
	static async getUserWithPassword(where) {
		return await this.scope('withPassword').findOne({ where });
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

	/**
	 * Update a user by id. Runs per-instance hooks so a changed password is
	 * hashed by the beforeUpdate hook before it is written.
	 * @param {object} user fields to change, including `id`
	 * @returns {Promise<[number]>} affected row count
	 */
	static async updateUser(user) {
		// With individualHooks, Sequelize also returns the affected instances
		// (password hash included); only ever hand back the count.
		const [count] = await this.update(
			{ ...user },
			{ where: { id: user.id }, individualHooks: true }
		);
		return [count];
	}

	static async banUser(userId) {
		return await this.update({ role: 'banned' }, { where: { id: userId } });
	}

	// Delete

	static async deleteUser(id) {
		return await this.destroy({ where: { id: id } });
	}
}
