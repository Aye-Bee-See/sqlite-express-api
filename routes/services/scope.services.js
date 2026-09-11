import { Op } from 'sequelize';
import AuthzService from '#rtServices/authz.services.js';
import User from '#models/user.model.js';

/**
 * Which chats and messages a caller may see and act on.
 *
 * - admin:   everything
 * - chapter: threads of writers the caller's group manages (including the
 *            group's anonymous writer). Threads relayed through the group
 *            will be added once letter routing exists.
 * - user:    the caller's own threads
 *
 * @typedef {object} ThreadScope
 * @property {'all'|'managed'|'own'} kind
 * @property {object} where  where-clause fragment on the `user` column; spread it LAST
 * @property {(userId: number|string) => boolean} allowsUser  may the caller act as / see this writer?
 * @property {(record: {user: number}) => boolean} allows     may the caller see this chat or message?
 * @property {number[]} [writerIds]  managed scope only
 */

/**
 * @param {object} req authenticated request
 * @returns {Promise<ThreadScope>}
 */
export async function threadScope(req) {
	if (AuthzService.isAdmin(req)) {
		return { kind: 'all', where: {}, allowsUser: () => true, allows: () => true };
	}
	if (AuthzService.hasRole(req, AuthzService.CHAPTER)) {
		const writerIds = await User.managedWriterIds(AuthzService.chapterOf(req));
		const allowed = new Set(writerIds.map(String));
		return {
			kind: 'managed',
			writerIds,
			where: { user: { [Op.in]: writerIds.length ? writerIds : [-1] } },
			allowsUser: (userId) => allowed.has(String(userId)),
			allows: (record) => Boolean(record) && allowed.has(String(record.user))
		};
	}
	const self = String(req.user.id);
	return {
		kind: 'own',
		where: { user: req.user.id },
		allowsUser: (userId) => String(userId) === self,
		allows: (record) => Boolean(record) && String(record.user) === self
	};
}

/**
 * Resolve which writer a new chat or message is attributed to.
 * - user role: always the caller.
 * - chapter: a writer the group manages; omitted means the group's
 *   anonymous writer.
 * - admin: whatever was given.
 * @param {object} req
 * @param {ThreadScope} scope
 * @param {number|string|undefined} requested `user` from the body
 * @returns {Promise<number>}
 * @throws forbidden when a chapter names a writer it does not manage
 */
export async function resolveWriter(req, scope, requested) {
	if (scope.kind === 'own') {
		return req.user.id;
	}
	if (scope.kind === 'managed') {
		if (requested === undefined || requested === null || requested === '') {
			const anonymous = await User.anonymousWriterFor(AuthzService.chapterOf(req));
			return anonymous.id;
		}
		if (!scope.allowsUser(requested)) {
			throw AuthzService.forbidden('Your group does not manage writer ' + requested + '.');
		}
		return requested;
	}
	return requested;
}
