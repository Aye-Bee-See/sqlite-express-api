import { Op, literal } from 'sequelize';
import AuthzService from '#rtServices/authz.services.js';
import User from '#models/user.model.js';
import Message from '#models/message.model.js';

/**
 * Which chats and messages a caller may see and act on.
 *
 * - admin:   everything
 * - chapter: threads of writers the caller's group manages (including the
 *            group's anonymous writer), plus letters the group relays;
 *            nothing while the group is not an active network member
 *            (`Messages.relayChapter`) and the chats those letters sit in
 * - user:    the caller's own threads
 *
 * @typedef {object} ThreadScope
 * @property {'all'|'managed'|'own'} kind
 * @property {object} where         where-clause fragment for Chat queries; spread it LAST
 * @property {object} messageWhere  where-clause fragment for Message queries; spread it LAST
 * @property {(userId: number|string) => boolean} allowsUser  may the caller act as / list this writer?
 * @property {(record: {user: number}) => Promise<boolean>} allows  may the caller see this chat?
 * @property {(record: {user: number, relayChapter?: number}) => boolean} allowsMessage
 * @property {number[]} [writerIds]  managed scope only
 * @property {number|null} [chapterId] managed scope only (null when the group is not active)
 * @property {() => Error} deny  the 403 to throw when a record is out of scope: for an
 *   inactive or missing group it explains that, otherwise it is a plain refusal
 */

/** Ids of chats that hold at least one letter relayed by the group. */
function relayedChatIds(chapterId) {
	return literal(
		'(SELECT DISTINCT `chat` FROM `Messages` WHERE `Messages`.`relayChapter` = ' +
			Number(chapterId) +
			')'
	);
}

/**
 * @param {object} req authenticated request
 * @returns {Promise<ThreadScope>}
 */
export async function threadScope(req) {
	if (AuthzService.isAdmin(req)) {
		return {
			kind: 'all',
			where: {},
			messageWhere: {},
			allowsUser: () => true,
			allows: async () => true,
			allowsMessage: () => true,
			deny: () => AuthzService.forbidden()
		};
	}
	if (AuthzService.hasRole(req, AuthzService.CHAPTER)) {
		const chapterId = await AuthzService.activeChapterOf(req);
		const refusal = chapterId ? null : await AuthzService.groupRefusal(req);
		const writerIds = await User.managedWriterIds(chapterId);
		const allowed = new Set(writerIds.map(String));
		const userIn = { [Op.in]: writerIds.length ? writerIds : [-1] };
		return {
			kind: 'managed',
			chapterId,
			writerIds,
			where: {
				[Op.or]: [{ user: userIn }, { id: { [Op.in]: relayedChatIds(chapterId || -1) } }]
			},
			messageWhere: { [Op.or]: [{ user: userIn }, { relayChapter: chapterId || -1 }] },
			allowsUser: (userId) => allowed.has(String(userId)),
			allows: async (chat) => {
				if (!chat) {
					return false;
				}
				if (allowed.has(String(chat.user))) {
					return true;
				}
				if (!chapterId) {
					return false;
				}
				const relayed = await Message.count({
					where: { chat: chat.id, relayChapter: chapterId }
				});
				return relayed > 0;
			},
			allowsMessage: (message) =>
				Boolean(message) &&
				(allowed.has(String(message.user)) ||
					(Boolean(chapterId) && message.relayChapter === chapterId)),
			deny: () => refusal || AuthzService.forbidden()
		};
	}
	const self = String(req.user.id);
	const isSelf = (record) => Boolean(record) && String(record.user) === self;
	return {
		kind: 'own',
		where: { user: req.user.id },
		messageWhere: { user: req.user.id },
		allowsUser: (userId) => String(userId) === self,
		allows: async (chat) => isSelf(chat),
		allowsMessage: isSelf,
		deny: () => AuthzService.forbidden()
	};
}

/**
 * Resolve which writer a new chat or message is attributed to.
 * - user role: always the caller.
 * - chapter: a writer the group manages; omitted means the group's
 *   anonymous writer. A prisoner reply may also be recorded for an
 *   independent writer on a thread the group relays.
 * - admin: whatever was given.
 * @param {object} req
 * @param {ThreadScope} scope
 * @param {number|string|undefined} requested `user` from the body
 * @param {{sender?: string, prisoner?: number|string}} [letter] for the relayed-reply case
 * @returns {Promise<number>}
 * @throws forbidden when a chapter names a writer outside its scope
 */
export async function resolveWriter(req, scope, requested, letter = {}) {
	if (scope.kind === 'own') {
		return req.user.id;
	}
	if (scope.kind === 'managed') {
		if (!scope.chapterId) {
			throw scope.deny();
		}
		if (requested === undefined || requested === null || requested === '') {
			const anonymous = await User.anonymousWriterFor(scope.chapterId);
			return anonymous.id;
		}
		if (scope.allowsUser(requested)) {
			return requested;
		}
		if (letter.sender === 'prisoner' && scope.chapterId && letter.prisoner !== undefined) {
			const relayed = await Message.count({
				where: { user: requested, prisoner: letter.prisoner, relayChapter: scope.chapterId }
			});
			if (relayed > 0) {
				return requested;
			}
		}
		throw AuthzService.forbidden('Your group does not manage writer ' + requested + '.');
	}
	return requested;
}
