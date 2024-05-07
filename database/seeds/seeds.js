const userSeed=require( "./userSeed.js");


exports.createSeeds = async  () => {
        return Promise.all([
        userSeed.createUserSeed()
    ]).then(() => {
        console.log('Seeds created');
    });
};