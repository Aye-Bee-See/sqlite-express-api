import { Model, Op } from 'sequelize';
import { randomBytes } from 'node:crypto';
import Schemas from '#schemas/all.schema.js';
import { hashToken } from '#models/claim-token.model.js';
import { invitationDays } from '#constants';

/** Crockford-style base32, as for claim tokens: reads aloud well. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newToken() {
	let out = '';
	for (const b of randomBytes(24)) {
		out += ALPHABET[b % 32];
	}
	return out;
}

function expiry() {
	return new Date(Date.now() + invitationDays * 24 * 60 * 60 * 1000);
}

/**
 * An invitation to join the network as a new group, or to join an existing
 * group as a member. The token is the credential: shown once to the
 * inviter, stored only as a hash, handed over in person or by a channel
 * the two already trust. The API never sends it anywhere.
 */
export default class Invitation extends Model {
	static init(sequelize) {
		return super.init(Schemas.invitation, {
			sequelize,
			modelName: 'Invitation',
			tableName: 'Invitations',
			defaultScope: { attributes: { exclude: ['tokenHash'] } },
			scopes: { withHash: {} }
		});
	}

	static associate(models) {
		this.belongsTo(models.Chapter, {
			as: 'chapter_details',
			foreignKey: 'chapterId',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Chapter, {
			as: 'created_chapter',
			foreignKey: 'createdChapter',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'inviter',
			foreignKey: 'invitedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'accepted_by',
			foreignKey: 'acceptedUser',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** `pending`, `expired`, `accepted`, or `revoked`, as a client should show it. */
	static stateOf(invitation, now = Date.now()) {
		if (invitation.status === 'pending' && new Date(invitation.expiresAt).getTime() <= now) {
			return 'expired';
		}
		return invitation.status;
	}

	/**
	 * @param {{kind: string, chapterId: number|null, inviteeName: string, inviteeEmail?: string, note?: string, invitedBy: number}} fields
	 * @returns {Promise<{invitation: Invitation, token: string}>} the plaintext token, shown once
	 */
	static async issue({ kind, chapterId, inviteeName, inviteeEmail, note, invitedBy }) {
		const token = newToken();
		const created = await this.create({
			kind,
			chapterId: chapterId ?? null,
			inviteeName: typeof inviteeName === 'string' ? inviteeName.trim() : inviteeName,
			inviteeEmail: inviteeEmail || null,
			note: note || null,
			invitedBy,
			tokenHash: hashToken(token),
			expiresAt: expiry()
		});
		return { invitation: await this.findByPk(created.id), token };
	}

	/**
	 * A fresh token and expiry for an invitation nobody has used; the old
	 * token stops working.
	 * @returns {Promise<{invitation: Invitation, token: string}|null>} null when it is no longer pending
	 */
	static async renew(id) {
		const token = newToken();
		const [count] = await this.update(
			{ tokenHash: hashToken(token), expiresAt: expiry() },
			{ where: { id, status: 'pending' } }
		);
		return count === 0 ? null : { invitation: await this.findByPk(id), token };
	}

	/** Withdraw a pending invitation. @returns {Promise<boolean>} false when it was not pending */
	static async revoke(id) {
		const [count] = await this.update({ status: 'revoked' }, { where: { id, status: 'pending' } });
		return count > 0;
	}

	/**
	 * @param {string} token plaintext
	 * @returns {Promise<{record: Invitation|null, state: 'valid'|'unknown'|'expired'|'accepted'|'revoked'}>}
	 */
	static async lookup(token) {
		if (typeof token !== 'string' || token.trim() === '') {
			return { record: null, state: 'unknown' };
		}
		const record = await this.findOne({ where: { tokenHash: hashToken(token) } });
		if (!record) {
			return { record: null, state: 'unknown' };
		}
		const state = Invitation.stateOf(record);
		return { record, state: state === 'pending' ? 'valid' : state };
	}

	/**
	 * Take the invitation for one acceptance. Conditional, so two requests
	 * with the same token cannot both create an account.
	 * @returns {Promise<boolean>}
	 */
	static async consume(id) {
		const [count] = await this.update(
			{ status: 'accepted', acceptedAt: new Date() },
			{ where: { id, status: 'pending', expiresAt: { [Op.gt]: new Date() } } }
		);
		return count > 0;
	}

	/**
	 * Hand back an invitation this request consumed, after its acceptance
	 * failed at any later step (a taken username, say). Only the request
	 * that won `consume` may call it.
	 */
	static async release(id) {
		await this.update(
			{ status: 'pending', acceptedAt: null, acceptedUser: null, createdChapter: null },
			{ where: { id, status: 'accepted' } }
		);
	}

	static async complete(id, { acceptedUser, createdChapter = null }) {
		await this.update({ acceptedUser, createdChapter }, { where: { id } });
	}
}
