const fs=require('node:fs');
const path=require('node:path');
const helper=require(path.normalize('../../routes/user/user.helper.js'));


exports.createUserSeed = async  () => {
    const count=await helper.countUsers;
   if (count === 0) {
        const seedPath = path.join(dirname, "userSeed.json");
        const seed = fs.readFileSync(seedPath);
        return await helper.createBulkUsers(seed);
    }
};

