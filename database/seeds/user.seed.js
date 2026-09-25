import { readFileSync as read } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import User from '#models/user.model.js';
import Chapter from '#models/chapter.model.js';

const filename = fileURLToPath(import.meta.url);

export async function createUserSeed() {
	const count = await User.countUsers();
	if (count === 0) {
		const seedPath = normalize(join(dirname(filename), 'userSeed.json'));
		const { seeds } = JSON.parse(read(seedPath, { encoding: 'utf8', flag: 'r' }));
		return await User.createBulkUsers(await withChapterIds(seeds));
	}
}

/**
 * A seeded group admin names its chapter (`"chapter": "Test Chapter"`) rather
 * than an id, which depends on what the database already holds. An account
 * whose chapter is not there is left out: a group admin of no group is not an
 * account anyone could use.
 */
async function withChapterIds(seeds) {
	const rows = [];
	for (const { chapter, ...row } of seeds) {
		if (chapter !== undefined) {
			const found = await Chapter.findOne({ where: { name: chapter }, attributes: ['id'] });
			if (!found) {
				console.warn(
					'Seed data: ' + row.username + ' left out; no chapter is named ' + chapter + '.'
				);
				continue;
			}
			row.chapterId = found.id;
		}
		rows.push(row);
	}
	return rows;
}
