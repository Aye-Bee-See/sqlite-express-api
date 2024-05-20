const { User, Chat } = require('../../sql-database');

// Create

const createUser = async ({ name, password, role, email }) => {
    return await User.create({name, password, role, email}, {individualHooks: true});
};

/**
 *  create multiple users
 *  
 *  @param {array} userArray  - Array of user params
 */
const createBulkUsers = async (userArray) => {
    return await User.bulkCreate(userArray, {individualHooks: true});
};

/**
 * Get raw user count
 * @returns {int} 
 */
const countUsers = async() => {
    const {count} = await User.findAndCountAll();
    
    return count;
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
    });
  }
  else {
  return await User.findAll({});
}
};

const getUsersByRole = async (role, full) => {
    if (full) {
      return await User.findAll({
        where: {role: role},
        include: [
          {
            model: Chat,
            as: "chats"
          }
        ]
      });
    }
    else {
      return await User.findAll({
        where: {role: role}
      });
    };
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
    });
  }
  else {
    return await User.findOne({
      where: obj,
    });
  };
};

const getUserByID = async (id, full) => {
  if (full) {
    return await User.findOne({
      where: {id: id},
      include: [
        {
          model: Chat,
          as: 'chats'
        }
      ]
    });
  }
  else {
    return await User.findOne({
      where: {id: id},
    });
  };
};

const getUserByEmail = async (email, full) => {
  if (full) {
    return await User.findOne({
      where: {email: email},
      include: [
        {
          model: Chat,
          as: 'chats'
        }
      ]
    });
  }
  else {
    return await User.findOne({
      where: {email: email},
    });
  };
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
    });
  }
  else {
    return await User.findOne({
      where: {name: name},
    });
  };
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
    });
  }
  else {
    return await User.findOne({
      where: {name: name, email: email},
    });
  };
}

// Update

const updateUser = async (newUser) => {
  return await User.update({...newUser}, { where: {id: newUser.id} });
};

// Delete

const deleteUser = async (id) => {
  return await User.destroy({ where: {id: id} });
};

module.exports = { createUser, createBulkUsers,
                   countUsers,
                  getAllUsers, getUsersByRole, getUser, getUserByID, getUserByEmail, getUserByName, getUserByNameOrEmail,
                  updateUser,
                  deleteUser
                  }