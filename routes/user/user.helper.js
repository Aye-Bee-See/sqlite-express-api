const { name } = require('./user.model');
const { User, Chat } = require('../../sql-database');

// Create

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

const getUserByName = async (name, full) => {
  if (full) {
    return await User.findOne({
      where: {name: name},
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
      where: {name: name},
    });
  }
}

const getUserByNameOrEmail = async (name, email, full) => {
  if (full) {
    return await User.findOne({
      where: {name: name, email: email},
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
      where: {name: name, email: email},
    });
  }
}

// Update

const updateUser = async (newUser) => {
  return await User.update({...newUser}, {where: {id: newUser.id}} );
};

// Delete

const deleteUser = async (id) => {
  return await User.destroy({ where: {id: id} });
};

module.exports = { createUser, 
                  getAllUsers, getUser, getUserByID, getUserByEmail, getUserByName, getUserByNameOrEmail,
                  updateUser,
                  deleteUser
                  }