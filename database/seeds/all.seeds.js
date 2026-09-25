import { createUserSeed } from '#db/seeds/user.seed.js';
import { createPrisonSeed } from '#db/seeds/prison.seed.js';
import { createPrisonerSeed } from '#db/seeds/prisoner.seed.js';
import { createChatSeed } from '#db/seeds/chat.seed.js';
import { createMessageSeed } from '#db/seeds/message.seed.js';
import { createChapterSeed } from '#db/seeds/chapter.seed.js';
import Utilities from '#services/Utilities.js';

/*
 Order of seeding:
 Chapter (a seeded group admin belongs to it)
 User
 Prison
 Prisoner (Requires Prison)
 Chat (Requires Prisoner and User)
 Message (Requires Chat)
 */

export async function createSeeds() {
	const seeds = [
		createChapterSeed,
		createUserSeed,
		createPrisonSeed,
		createPrisonerSeed,
		createChatSeed,
		createMessageSeed
	];

	const seedsData = await Utilities.resolveSequential(seeds);
	const names = ['chapters', 'users', 'prisons', 'prisoners', 'chats', 'messages'];
	const summary = names.map((name, i) => {
		const rows = seedsData[i];
		return Array.isArray(rows)
			? name + ': ' + rows.length + ' seeded'
			: name + ': already populated';
	});
	console.log('Seed data: ' + summary.join(', ') + '.');
}
