import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#db/hooks/all.hooks.mjs';


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
    
    static async createUser( { name, password, role, email }) {
        return await this.create({name, password, role, email});
    }

    /**
     *  create multiple users
     *  
     *  @param {array} userArray  - Array of user params
     */

    static async createBulkUsers(userArray) {
        return await this.bulkCreate(userArray, {individualHooks: true});
    }

    /**
     * Get raw user count
     * @returns {int} 
     */
    static async countUsers() {
        const {count} = await this.findAndCountAll();

        return count;
    }

    static async getAllUsers(full) {
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
            return await this.findAll({
            });
        }
    }

    static async getUser(obj, full) {
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
                where: obj
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
                where: {id: id}
            });
        }

    }

}