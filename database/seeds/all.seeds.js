import { createUserSeed } from '#db/seeds/user.seed.js';
import { createPrisonSeed } from '#db/seeds/prison.seed.js';
import { createPrisonerSeed } from '#db/seeds/prisoner.seed.js';
import { createRuleSeed } from '#db/seeds/rule.seed.js';
import { createChapterSeed } from '#db/seeds/chapter.seed.js';
import { createChatSeed } from '#db/seeds/chat.seed.js';
import { createMessageSeed } from '#db/seeds/message.seed.js';
import Utilities from '#services/Utilities.js';

/*
 Order of seeding:
 User
 Prison
 Prisoner (Requires Prison)
 Rules (Requires Prison)
 Chapter
 Chat (Requires User and Prisoner)
 Message (Requires Chat, User, and Prisoner)
 */

export async function createSeeds() {
	const seeds = [
		createUserSeed,
		createPrisonSeed,
		createPrisonerSeed,
		createRuleSeed,
		createChapterSeed,
		createChatSeed,
		createMessageSeed
	];

	const seedsData = await Utilities.resolveSequential(seeds);
	if (!process.env.SUPPRESS_SEED_LOGS) {
		console.log('\x1b[48;5;49;38;5;33;1;7m%s\x1b[0m', ' * * * * * * * * * * * * * * * * * ');
		console.log('\x1b[48;5;49;38;5;33;1;7m%s\x1b[0m', ' * * * * * * Seed Data * * * * * * ');
		console.log('\x1b[48;5;49;38;5;33;1;7m%s\x1b[0m', ' * * * * * * * * * * * * * * * * * ');
		console.group('\x1b[48;5;49;38;5;33;1m%s\x1b[0m', '       In file all.seeds.js       ');
	}
	for (let i = 0; i < seedsData.length; i++) {
		//get all keys
		let seedsDataKeys = Object.keys(seedsData[i][0]);
		const seedsDataValuesIndex = seedsDataKeys.indexOf('dataValues');
		// remove dataValues from list of keys
		seedsDataKeys.splice(seedsDataValuesIndex, 1);
		// remove all keys except dataValues
		seedsDataKeys.forEach((keyThatIsNotDataValues) => {
			delete seedsData[i][0][keyThatIsNotDataValues];
		});
		if (!process.env.SUPPRESS_SEED_LOGS) {
			console.log('%O', seedsData[i][0]);
		}
	}
	if (!process.env.SUPPRESS_SEED_LOGS) {
		console.groupEnd();
		console.log('\x1b[48;5;49;38;5;33;1m%s\x1b[0m', '           End Seed Data           ');
	}
}
