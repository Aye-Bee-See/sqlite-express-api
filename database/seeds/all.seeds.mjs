import {createUserSeed} from  '#db/seeds/user.seed.mjs';


export async function createSeeds() {
    return Promise.all([
        createUserSeed()
    ]).then(() => {
        console.log('Seeds created');
    });
};