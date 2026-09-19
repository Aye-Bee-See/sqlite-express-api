import Notification from '#models/notification.model.js';
import Device from '#models/device.model.js';
import User from '#models/user.model.js';
import * as push from '#services/push.js';

/**
 * Tell accounts that something happened: an entry in each one's feed, and
 * a content-free push to their devices. Never throws: what it announces
 * has already been committed, and a missed doorbell must not undo it or
 * fail the request.
 *
 * @param {(number|null|undefined)[]} userIds recipients; duplicates, blanks, and the actor are dropped
 * @param {{event: string, chat?: number, message?: number, submission?: number, detail?: object}} what
 * @param {{actor?: number|null}} [options] the account that did it, who does not need telling
 */
export async function notify(userIds, what, { actor = null } = {}) {
	try {
		const wanted = [...new Set(userIds.filter((id) => id !== null && id !== undefined))]
			.map(Number)
			.filter((id) => id !== Number(actor));
		if (wanted.length === 0) {
			return [];
		}
		// Only accounts somebody can sign in to: not banned, not an unclaimed or anonymous writer.
		const accounts = await User.findAll({
			where: { id: wanted },
			attributes: ['id', 'role', 'managedBy', 'claimedAt']
		});
		const recipients = accounts
			.filter((user) => user.role !== 'banned' && !User.isUnclaimedManaged(user))
			.map((user) => user.id);
		if (recipients.length === 0) {
			return [];
		}
		const entries = await Notification.record(recipients, what);
		push.ring(await Device.reachable(recipients), (token) => Device.forgetToken(token));
		return entries;
	} catch (err) {
		console.error('[notify] ' + what.event + ' was not announced', err);
		return [];
	}
}

/** The members of a group, to tell them a letter is waiting. */
export async function membersOf(chapterId) {
	if (!chapterId) {
		return [];
	}
	const members = await User.findAll({
		where: { chapterId, role: 'chapter' },
		attributes: ['id']
	});
	return members.map((member) => member.id);
}
