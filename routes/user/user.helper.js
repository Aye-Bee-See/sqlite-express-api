const User = require('../../sql-database').User

const createUser = async ({ name, password, role, email }) => { 
  return await User.create({ name, password, role, email });
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

module.exports = { createUser, getAllUsers, getUser, getUserByID }