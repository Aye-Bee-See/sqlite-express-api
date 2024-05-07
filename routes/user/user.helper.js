const User = require('../../sql-database').User
const Chat = require('../../sql-database').Chat

const createUser = async ({ name, password, role, email }) => {
    return await User.create({name, password, role, email});
};

/**
 *  create multiple users
 *  
 *  @param {array} userArray  - Array of user params
 */
const createBulkUsers = async (userArray) => {
    return await User.bulkCreate(userArray);
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
        })
    } else {
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
    } else {
        return await User.findOne({
            where: obj,
        });
    }
};
const getUserByID = async function (id, full) {
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
    } else {
        return await User.findOne({
            where: {id: id},
        });
    }

}
;

module.exports = {createUser, createBulkUsers, countUsers, getAllUsers, getUser, getUserByID}