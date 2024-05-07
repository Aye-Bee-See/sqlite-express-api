const {User, Chat} = require('../../sql-database');

const createUser = async ({ name, password, role, email }) => { 
  return await User.create({ name, password, role, email });
};
const getAllUsers = async (full) => {
  if (full) {
    return await User.findAll({
      include: [
        {
          model: Chat,
          as: "chats"
        }
      ]
    })
  }
  else {
  return await User.findAll({  
  });
}
};
const getUser = async (obj, full) => {
  if (full) {
    return await User.findOne({
      where: obj,
      include: [
        {
          model: Chat,
          as: 'chats'
        }
      ]
    })
  }
  else {
    return await User.findOne({
      where: obj,
    });
  }
};
const getUserByID = async function(id, full) {
  if (full) {
    return await User.findOne({
      where: {id: id},
      include: [
        {
          model: Chat,
          as: 'chats'
        }
      ]
    })
  }
  else {
    return await User.findOne({
      where: {id: id},
    });
  }

};

module.exports = { createUser, getAllUsers, getUser, getUserByID }