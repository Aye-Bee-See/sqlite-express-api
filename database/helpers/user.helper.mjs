


    export async function createUser( { name, password, role, email }) {
        return await this.table.create({name, password, role, email});
    }
    
    /**
 *  create multiple users
 *  
 *  @param {array} userArray  - Array of user params
 */

    export async function createBulkUsers (userArray) {
    return await this.table.bulkCreate(userArray, {individualHooks: true});
}

/**
 * Get raw user count
 * @returns {int} 
 */
    export async function countUsers () {
    const {count} = await this.table.findAndCountAll();

    return count;
}

    export async function getAllUsers(full) {
    if (full) {
        return await this.table.findAll({
            include: [
                {
                    model: Chat,
                    as: "chats"
                }
            ]
        });
    } else {
        return await this.table.findAll({
        });
    }
}

    export async function getUser  (obj, full) {
    if (full) {
        return await this.table.findOne({
            where: obj,
            include: [
                {
                    model: Chat,
                    as: 'chats'
                }
            ]
        });
    } else {
        return await this.table.findOne({
            where: obj
        });
    }
}
    export async function getUserByID (id, full) {
    if (full) {
        return await this.table.findOne({
            where: {id: id},
            include: [
                {
                    model: Chat,
                    as: 'chats'
                }
            ]
        });
    } else {
        return await this.table.findOne({
            where: {id: id}
        });
    }

}
