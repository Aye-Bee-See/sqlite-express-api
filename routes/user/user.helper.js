const User = require('../../sql-database').User

const createUser = async ({ name, password, role, email }) => { 
  return await User.create({ name, password, role, email });
};

/**
 *  create multiple users
 *  
 *  @param {array} userArray  - Array of user params
 */
const createBulkUsers=async (userArray)=>{
    return await User.bulkCreate(userArray);
};

/**
 * Get raw user count
 * @returns {int} 
 */
const countUsers= async()=>{
    const {count} = await User.findAndCountAll();
    console.log("fakjdslllllladsjflkdsajfldsjfljlkjdslkflkdsjfjdsflkdsajflkkdsfjdsfldsjfl:     ".count);
    return count;
};

const getAllUsers = async () => {
  return await User.findAll();
};
const getUser = async obj => {
  return await User.findOne({
  where: obj,
});
};
const getUserByID = async function(id) {
  return await User.findOne({
  where: {id: id},
});
};

module.exports = { createUser, createBulkUsers, countUsers, getAllUsers, getUser, getUserByID }