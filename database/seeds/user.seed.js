import { readFileSync as read } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import User from '#models/user.model.js';

const filename = fileURLToPath(import.meta.url);

export async function createUserSeed() {
	const count = await User.countUsers();
	if (count === 0) {
		const seedPath = normalize(join(dirname(filename), 'userSeed.json'));
		const { seeds } = JSON.parse(read(seedPath, { encoding: 'utf8', flag: 'r' }));
		return await User.createBulkUsers(seeds);
	}
}
