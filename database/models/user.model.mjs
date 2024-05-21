import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#hooks/all.hooks.mjs';


export default class User extends Model {
    static init(sequelize) {
        return super.init(
                Schemas.user,
                {
                    sequelize,
                    hooks: Hooks.user || null,
                    modelName: 'User',
                    tableName: 'User'
                }
        );
    }

    static associate(models) {
        this.hasMany(models.Chat, {as: 'chats', foreignKey: 'user_key'});
    }

// Create

    static async  createUser( { name, password, role, email })  {
        return await this.create({name, password, role, email}, {individualHooks: true});
    } 

    /**
     *  create multiple users
     *  
     *  @param {array} userArray  - Array of user params
     */
    static async  createBulkUsers(userArray) {
        return await this.bulkCreate(userArray, {individualHooks: true});
    }

    /**
     * Get raw user count
     * @returns {int} 
     */
    static async  countUsers() {
        const {count} = await this.findAndCountAll();

        return count;
    }

    static async  getAllUsers(full) {
        if (full) {
            return await this.findAll({
                include: [
                    {
                        model: Chat,
                        as: "chats"
                    }
                ]
            });
        } else {
            return await User.findAll({});
        }
    }

    static async  getUsersByRole(role, full) {
        if (full) {
            return await this.findAll({
                where: {role: role},
                include: [
                    {
                        model: Chat,
                        as: "chats"
                    }
                ]
            });
        } else {
            return await this.findAll({
                where: {role: role}
            });
        }
    }

    static async  getUser(obj, full) {
        if (full) {
            return await this.findOne({
                where: obj,
                include: [
                    {
                        model: Chat,
                        as: 'chats'
                    }
                ]
            });
        } else {
            return await this.findOne({
                where: obj,
            });
        }
    }
    static async getUserByID(id, full) {
        if (full) {
            return await this.findOne({
                where: {id: id},
                include: [
                    {
                        model: Chat,
                        as: 'chats'
                    }
                ]
            });
        } else {
            return await this.findOne({
                where: {id: id},
            });
        }
    }
    static async getUserByEmail(email, full) {
        if (full) {
            return await this.findOne({
                where: {email: email},
                include: [
                    {
                        model: Chat,
                        as: 'chats'
                    }
                ]
            });
        } else {
            return await this.findOne({
                where: {email: email},
            });
        }
    }
    static async getUserByName(name, full) {
        if (full) {
            return await this.findOne({
                where: {name: name},
                include: [
                    {
                        model: Chat,
                        as: 'chats'
                    }
                ]
            });
        } else {
            return await this.findOne({
                where: {name: name},
            });
        }
    }

    static async getUserByNameOrEmail(name, email, full) {
        if (full) {
            return await this.findOne({
                where: {name: name, email: email},
                include: [
                    {
                        model: Chat,
                        as: 'chats'
                    }
                ]
            });
        } else {
            return await this.findOne({
                where: {name: name, email: email},
            });
        }
    }

// Update

    static async updateUser(newUser) {
        return await this.update({...newUser}, {where: {id: newUser.id}});
    }
// Delete

    static async deleteUser(id) {
        return await this.destroy({where: {id: id}});
    }
}