import {createUserSeed} from  './userSeed.mjs';


export async function createSeeds() {
    return Promise.all([
        createUserSeed()
    ]).then(() => {
        console.log('Seeds created');
    });
};