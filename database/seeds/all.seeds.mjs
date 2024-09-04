import {createUserSeed} from  '#db/seeds/user.seed.mjs';
import {createPrisonSeed} from  '#db/seeds/prison.seed.mjs';
import {createPrisonerSeed} from  '#db/seeds/prisoner.seed.mjs';
import {createRuleSeed} from  '#db/seeds/rule.seed.mjs';
import {createChatSeed} from  '#db/seeds/chat.seed.mjs';
import {createMessageSeed} from  '#db/seeds/message.seed.mjs';

/*
Order of seeding:
User
Prison
Prisoner (Requires Prison)
Rules (Requires Prison)
Chat (Requires Prisoner and User)
Message (Requires Chat)
*/

export async function createSeeds() {
    return Promise.all([
        createUserSeed()

    ]).then(() => {
        console.log('Seeds created');
    });
};