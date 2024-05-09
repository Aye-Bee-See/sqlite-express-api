const User = require('../../sql-database').User
const Chat = require('../../sql-database').Chat

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

const getUserByEmail = async function(email, full) {
  if (full) {
    return await User.findOne({
      where: {email: email},
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
      where: {email: email},
    });
  }
};

module.exports = { createUser, getAllUsers, getUser, getUserByID }