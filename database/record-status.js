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
