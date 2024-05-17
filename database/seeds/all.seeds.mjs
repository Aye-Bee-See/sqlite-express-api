import {createUserSeed} from  '#db/seeds/userSeed.mjs';


export async function createSeeds() {
    return Promise.all([
        createUserSeed()
    ]).then(() => {
        console.log('Seeds created');
    });
};