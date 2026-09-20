import { Model, Op } from 'sequelize';
import { randomBytes } from 'node:crypto';
import Schemas from '#schemas/all.schema.js';
import pick, { updateById } from '#db/pick.js';
import Hooks from '#hooks/all.hooks.js';
import Chat from '#models/chat.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';

/** Case-insensitive substring match on username, email, and name. */
function searchWhere(q) {
	const term = typeof q === 'string' ? q.trim() : '';
	if (!term) {
		return {};
	}
	return {
		[Op.or]: ['username', 'email', 'name'].map((field) => ({
			[field]: { [Op.like]: '%' + term + '%' }
		}))
	};
}

/** Key columns hidden from every read except GET /auth/keys and the recovery flow. */
export const KEY_COLUMNS = [
	'wrappedPrivateKey',
	'kdfSalt',
	'kdfParams',
	'recoveryWrappedPrivateKey',
	'recoverySalt',
	'recoveryKdfParams',
	'orgWrappedPrivateKey',
	'recoveryChallengeHash',
	'recoveryChallengeExpiresAt'
];

/** Fields a client may supply to set up an account's keys. */
export const KEY_INPUT = [
	'publicKey',
	'wrappedPrivateKey',
	'kdfSalt',
	'kdfParams',
	'recoveryWrappedPrivateKey',
	'recoverySalt',
	'recoveryKdfParams'
];

/**
 * What PUT /auth/user may write (the controller decides who may write which).
 * Not here, on purpose: the recovery columns (PUT /auth/keys and the recovery
 * flow own them; a settable recovery challenge is an account takeover),
 * sessionsRevokedAt, and the dates.
 */
const UPDATABLE = [
	'name',
	'username',
	'password',
	'email',
	'bio',
	'role',
	'chapterId',
	'managedBy',
	'claimedAt',
	'claimedFrom',
	'anonymousForChapter',
	'managerNote',
	'retentionDays',
	'publicKey',
	'wrappedPrivateKey',
	'kdfSalt',
	'kdfParams',
	'orgWrappedPrivateKey'
];

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
			defaultScope: { attributes: { exclude: ['password', ...KEY_COLUMNS] } },
			scopes: {
				withKeys: { attributes: { exclude: ['password'] } },
				withPassword: { attributes: { include: ['password'] } }
			}
		});
	}

	static associate(models) {
		this.belongsTo(models.Chapter, {
			as: 'chapter',
			foreignKey: 'chapterId',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Chapter, {
			as: 'managing_chapter',
			foreignKey: 'managedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Chapter, {
			as: 'claimed_from_chapter',
			foreignKey: 'claimedFrom',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Chapter, {
			as: 'anonymous_for_chapter',
			foreignKey: 'anonymousForChapter',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
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

	static async createUser({ username, password, role, email, name, bio, chapterId, ...rest }) {
		User.refuseReserved({ username, email });
		const keys = {};
		for (const field of KEY_INPUT) {
			if (rest[field] !== undefined) {
				keys[field] = rest[field];
			}
		}
		return await this.create(
			{ username, password, role, email, name, bio, chapterId, ...keys },
			{ individualHooks: true }
		);
	}

	/**
	 * e2e: the group-sealed private keys of managed writers, by writer id, so
	 * the managing group can read and print for them.
	 * @param {number[]} ids
	 * @returns {Promise<Map<number, string|null>>}
	 */
	static async orgWrappedKeysFor(ids) {
		if (ids.length === 0) {
			return new Map();
		}
		const rows = await this.scope('withKeys').findAll({
			where: { id: ids },
			attributes: ['id', 'orgWrappedPrivateKey']
		});
		return new Map(rows.map((r) => [r.id, r.orgWrappedPrivateKey]));
	}

	/**
	 * Refuse every token issued before now. Tokens carry a millisecond
	 * `issued` time, so the fresh token handed back after a password change
	 * (issued after this call) still passes.
	 */
	static async revokeSessions(userId) {
		const at = new Date();
		await this.update({ sessionsRevokedAt: at }, { where: { id: userId } });
		// Signed out everywhere means no device should keep ringing for this account.
		// The app registers again after the next sign-in.
		await this.sequelize.models.Device.forgetUser(userId);
		return at;
	}

	/** One account with its key material (never through the default scope). */
	static async getUserWithKeys(where) {
		return await this.scope('withKeys').findOne({ where });
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

	static async getAllUsers(full, limit, offset = 0, q = '') {
		let filters = { limit, offset, where: searchWhere(q) };
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
	static async getUsersByRole(role, full, limit, offset = 0, q = '') {
		const allowedRoles = Schemas.user.role.validate.isIn.args[0];
		const normalizedRole = typeof role === 'string' ? role.toLowerCase() : role;
		if (!allowedRoles.includes(normalizedRole)) {
			throw new ValidationError(
				'Unknown role "' + role + '". Expected one of: ' + allowedRoles.join(', ') + '.'
			);
		}
		let filters = { limit, offset, where: { role: normalizedRole, ...searchWhere(q) } };
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

	// Managed writers

	/** Placeholder address for a managed writer who gave no email. */
	static placeholderEmail(tag) {
		return 'writer-' + tag + '@managed.example';
	}

	static isPlaceholderEmail(email) {
		return typeof email === 'string' && email.endsWith('@managed.example');
	}

	/**
	 * The names the API gives the accounts it makes itself. A person who took
	 * `anon-7` would stop group 7 from ever getting its anonymous writer.
	 * @throws {ValidationError} when a person asks for one
	 */
	static refuseReserved({ username, email } = {}) {
		if (typeof username === 'string' && /^(anon|writer)-/i.test(username.trim())) {
			throw new ValidationError(
				'Usernames that start with "anon-" or "writer-" are kept for accounts the groups manage.'
			);
		}
		if (User.isPlaceholderEmail(typeof email === 'string' ? email.trim().toLowerCase() : email)) {
			throw new ValidationError('That email address is not a real one; use your own.');
		}
	}

	/** Is this account in a chapter's custody and not yet claimed? */
	static isUnclaimedManaged(user) {
		return Boolean(user && user.managedBy && !user.claimedAt);
	}

	/**
	 * Can this account be handed to a person? An unclaimed managed writer can.
	 * A group's shared anonymous account never: it is not one person, it holds
	 * the anonymous letters of everybody the group ever wrote for, and whoever
	 * claimed it would own them all and receive the next ones too.
	 */
	static isClaimable(user) {
		return User.isUnclaimedManaged(user) && !user.anonymousForChapter;
	}

	/**
	 * Create an account under a chapter's custody. The writer gets a generated
	 * username, an unguessable password (login is refused until claimed
	 * anyway), and a placeholder email unless one is given.
	 * @param {{name: string, email?: string, managerNote?: string, chapterId: number}} fields
	 */
	static async createManagedWriter({
		name,
		email,
		managerNote,
		chapterId,
		publicKey = null,
		orgWrappedPrivateKey = null
	}) {
		// 'writer-' plus 8 hex characters fits the 16-character username limit.
		const tag = randomBytes(4).toString('hex');
		const cleanEmail = typeof email === 'string' && email.trim() !== '' ? email.trim() : null;
		return await this.create(
			{
				username: 'writer-' + tag,
				password: randomBytes(24).toString('base64url'),
				email: cleanEmail || User.placeholderEmail(tag),
				name,
				role: 'user',
				managedBy: chapterId,
				claimedAt: null,
				claimedFrom: null,
				managerNote: managerNote || null,
				publicKey,
				orgWrappedPrivateKey
			},
			{ individualHooks: true }
		);
	}

	/**
	 * The chapter's anonymous-writer account, created on first use.
	 * @param {number} chapterId
	 * @returns {Promise<User>}
	 */
	static async anonymousWriterFor(chapterId) {
		const existing = await this.findOne({ where: { anonymousForChapter: chapterId } });
		if (existing) {
			return existing;
		}
		const tag = 'anon-' + chapterId;
		return await this.create(
			{
				username: 'anon-' + chapterId,
				password: randomBytes(24).toString('base64url'),
				email: User.placeholderEmail(tag),
				name: 'Anonymous writer',
				role: 'user',
				managedBy: chapterId,
				anonymousForChapter: chapterId
			},
			{ individualHooks: true }
		);
	}

	/**
	 * Ids of every account a chapter manages (including its anonymous writer).
	 * @param {number} chapterId
	 * @returns {Promise<number[]>}
	 */
	static async managedWriterIds(chapterId) {
		if (!chapterId) {
			return [];
		}
		const rows = await this.findAll({ where: { managedBy: chapterId }, attributes: ['id'] });
		return rows.map((r) => r.id);
	}

	/**
	 * One page of managed writers, optionally for one chapter.
	 * @param {{chapterId?: number, limit?: number, offset?: number, q?: string}} options
	 */
	static async listManagedWriters({ chapterId, limit, offset = 0, q = '' } = {}) {
		const where = { managedBy: chapterId ? chapterId : { [Op.ne]: null }, ...searchWhere(q) };
		return await this.findAndCountAll({
			where,
			limit,
			offset,
			order: [['id', 'ASC']]
		});
	}

	/**
	 * Turn a managed writer into an independent account.
	 * @param {User} user the writer
	 * @param {{username: string, password: string, email?: string}} credentials
	 * @returns {Promise<[number]>} affected row count
	 */
	static async claim(user, { username, password, email, keys = {} }, { transaction } = {}) {
		if (!User.isClaimable(user)) {
			throw new HttpError(409, 'This account cannot be claimed.', 'ClaimError');
		}
		User.refuseReserved({ username, email });
		const values = {
			username,
			password,
			claimedAt: new Date(),
			claimedFrom: user.managedBy,
			managedBy: null,
			// The group's copy of the private key goes with custody.
			orgWrappedPrivateKey: null,
			...keys
		};
		if (typeof email === 'string' && email.trim() !== '') {
			values.email = email.trim();
		}
		const [count] = await this.update(values, {
			// Only while it is still unclaimed, whatever was true when `user` was read.
			where: { id: user.id, claimedAt: null, managedBy: { [Op.ne]: null } },
			individualHooks: true,
			transaction
		});
		if (count !== 1) {
			throw new HttpError(409, 'This account cannot be claimed.', 'ClaimError');
		}
		return [count];
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
		return await updateById(this, user.id, pick(user, UPDATABLE), { individualHooks: true });
	}

	static async banUser(userId) {
		return await this.update({ role: 'banned' }, { where: { id: userId } });
	}

	// Delete

	// Deleting an account is more than one row: see database/erase-account.js.
}
