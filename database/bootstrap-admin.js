import User from '#models/user.model.js';
import { adminUsername, adminPassword, adminEmail, quietBoot } from '#constants';

const ADMIN_ROLE = 'admin';
const BANNER = '\x1b[48;2;255;92;0;38;2;253;230;255;1m%s\x1b[0m';

/**
 * Make sure an administrator account exists.
 *
 * Configured through ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_EMAIL:
 * - If all three are set and no user with that username exists, the account
 *   is created with the admin role. An existing account with that username is
 *   left untouched, even if it is not an admin, so a stray env value can never
 *   silently escalate someone.
 * - If they are not set and the database holds no admin at all, a loud error
 *   is printed. The server keeps running, but nothing admin-only can be done
 *   until the variables are provided or an admin is created some other way.
 *
 * Runs after seeding, so in development the seeded admin already satisfies the
 * "an admin exists" check and the configured account is created alongside it.
 *
 * @returns {Promise<User|null>} the created user, or null when nothing was created
 */
export async function ensureAdmin() {
	const configured = Boolean(adminUsername && adminPassword && adminEmail);

	if (!configured) {
		const adminCount = await User.count({ where: { role: ADMIN_ROLE } });
		if (adminCount === 0 && !quietBoot) {
			console.group(BANNER, ' ****** NO ADMIN ACCOUNT ***** ');
			console.error(
				'No user has the admin role and ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_EMAIL are not all set.'
			);
			console.error('Set them in .env and restart to create the first administrator.');
			console.groupEnd();
		}
		return null;
	}

	const existing = await User.getUser({ username: adminUsername });
	if (existing) {
		if (existing.role !== ADMIN_ROLE) {
			console.warn(
				'ADMIN_USERNAME "' +
					adminUsername +
					'" already exists with role "' +
					existing.role +
					'"; leaving it unchanged.'
			);
		} else {
			if (!quietBoot) {
				console.log('Admin account "' + adminUsername + '" already exists.');
			}
		}
		return null;
	}

	const created = await User.createUser({
		username: adminUsername,
		password: adminPassword,
		email: adminEmail,
		role: ADMIN_ROLE,
		name: 'Administrator'
	});
	if (!quietBoot) {
		console.log('Created admin account "' + adminUsername + '" (id ' + created.id + ').');
	}
	return created;
}
