import { Op } from 'sequelize';

/**
 * Publication state of directory records (prisons, prisoners, chapters).
 *
 * - draft:     being written; visible to staff (admin, chapter) only
 * - pending:   submitted for review; visible to staff only
 * - published: visible to everyone, including anonymous callers
 *
 * Until the moderation queue exists, new records default to published so
 * that existing flows keep working; staff can set draft or pending
 * explicitly on create or update.
 */
export const RECORD_STATUSES = ['draft', 'pending', 'published'];
export const PUBLISHED = 'published';

/** Sequelize attribute definition shared by the three schemas. */
export const recordStatusAttribute = {
	allowNull: false,
	defaultValue: PUBLISHED,
	validate: {
		isIn: {
			args: [RECORD_STATUSES],
			msg: 'Record status must be draft, pending, or published.'
		}
	}
};

/**
 * Where-clause fragment that limits a query to published rows, or nothing.
 * @param {boolean} publishedOnly
 * @returns {object}
 */
export function publishedWhere(publishedOnly) {
	return publishedOnly ? { recordStatus: PUBLISHED } : {};
}

/** A verification older than this is stale (about six months). */
export const STALE_AFTER_DAYS = 183;

/**
 * Where-fragment: records never verified, or verified more than
 * STALE_AFTER_DAYS ago. Prisoners and prisons carry `verifiedAt`.
 */
export function staleVerificationWhere(now = new Date()) {
	const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
	return { [Op.or]: [{ verifiedAt: null }, { verifiedAt: { [Op.lt]: cutoff } }] };
}
