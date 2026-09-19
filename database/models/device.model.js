import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';

/**
 * A device an account is signed in on, with the push token that reaches
 * it. The token is a capability (whoever has it can ring that device), so
 * the default scope leaves it out and only the sender reads it.
 */
export default class Device extends Model {
	static init(sequelize) {
		return super.init(Schemas.device, {
			sequelize,
			modelName: 'Device',
			tableName: 'Devices',
			defaultScope: { attributes: { exclude: ['token', 'sessionId'] } },
			scopes: { withToken: {} }
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'owner',
			foreignKey: 'userId',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
	}

	/**
	 * Register a device, or refresh it. A token belongs to one account at a
	 * time: when someone else signs in on the same phone the token moves to
	 * them, so the previous account's notifications stop arriving there.
	 * @returns {Promise<{device: Device, created: boolean}>}
	 */
	static async register({ userId, provider = 'fcm', platform, token, label, sessionId }) {
		const candidate = this.build({ userId, provider, platform, token, label, sessionId });
		await candidate.validate();
		const existing = await this.scope('withToken').findOne({ where: { token } });
		if (!existing) {
			const created = await candidate.save();
			return { device: await this.findByPk(created.id), created: true };
		}
		const moved = existing.userId !== userId;
		existing.set({
			userId,
			provider,
			platform,
			sessionId,
			lastSeenAt: new Date(),
			// A phone that changes hands does not inherit the last owner's settings.
			...(moved ? { muted: false, label: label ?? null } : label !== undefined ? { label } : {})
		});
		await existing.save();
		return { device: await this.findByPk(existing.id), created: false };
	}

	/** The devices to ring for these accounts, tokens included. */
	static async reachable(userIds) {
		if (userIds.length === 0) {
			return [];
		}
		return await this.scope('withToken').findAll({ where: { userId: userIds, muted: false } });
	}

	/** Signing out on one device stops its pushes. */
	static async forgetSession(sessionId) {
		return sessionId ? await this.destroy({ where: { sessionId } }) : 0;
	}

	/** Signing out everywhere, a password change, a revocation: every device goes. */
	static async forgetUser(userId) {
		return await this.destroy({ where: { userId } });
	}

	/** The push service said this token is dead. */
	static async forgetToken(token) {
		return await this.destroy({ where: { token } });
	}
}
