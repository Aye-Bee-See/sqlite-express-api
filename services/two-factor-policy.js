import { SiteSetting, Chapter } from '#db/sql-database.js';

/**
 * Who must use two-factor sign-in (decided 30 September 2026). A superadmin may
 * require it for all superadmins, for the group admins of every group, or for
 * the group admins of chosen groups (Chapters.requireTwoFactor). Everything starts
 * off, so until a superadmin switches something on, it is optional for everyone.
 * Writers are never required to use it.
 */
const KEY = 'twoFactorRequired';
const NONE = { superadmins: false, allGroups: false };

export async function sitePolicy() {
	return { ...NONE, ...(await SiteSetting.read(KEY, NONE)) };
}

export async function setSitePolicy(changes, updatedBy) {
	const next = { ...(await sitePolicy()), ...changes };
	await SiteSetting.write(KEY, next, updatedBy);
	return next;
}

/**
 * Must this account use two-factor sign-in, and why?
 * @returns {Promise<{required: boolean, because: string[]}>} `because` holds
 *   `superadmins`, `all_groups` or `group`
 */
export async function requirementFor(user) {
	if (!user) {
		return { required: false, because: [] };
	}
	const policy = await sitePolicy();
	const because = [];
	if (user.role === 'admin' && policy.superadmins) {
		because.push('superadmins');
	}
	if (user.role === 'chapter') {
		if (policy.allGroups) {
			because.push('all_groups');
		}
		if (user.chapterId) {
			const group = await Chapter.findByPk(user.chapterId, {
				attributes: ['id', 'requireTwoFactor']
			});
			if (group && group.requireTwoFactor) {
				because.push('group');
			}
		}
	}
	return { required: because.length > 0, because };
}
