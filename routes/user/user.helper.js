const {name} = require('./user.model');

const User = require('../../sql-database').User
const Chat = require('../../sql-database').Chat

const createUser = async ({ name, password, role, email }) => {
    return await User.create({name, password, role, email});
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
};

const getUserByEmail = async function (email, full) {
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
    } else {
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
    } else {
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
    } else {
        return await User.findOne({
            where: {name: name, email: email},
        });
    }
}

module.exports = {createUser, createBulkUsers, countUsers, getAllUsers, getUser, getUserByID, getUserByEmail, getUserByName, getUserByNameOrEmail}
