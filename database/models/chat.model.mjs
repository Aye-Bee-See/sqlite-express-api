import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#hooks/all.hooks.mjs';
import Message from '#models/message.model.mjs';
import Prisoner from '#models/prisoner.model.mjs';
import User from '#models/user.model.mjs';

export default class Chat extends Model {
    static init(sequelize) {
        return super.init(
                Schemas.chat,
                {
                    sequelize,
                    hooks: Hooks.chat || null,
                    modelName: 'Chat'
                }
        );
    }
    static associate(models) {
        this.belongsTo(models.Prisoner, {as: 'prisoner_details', foreignKey: 'prisonerId'});
        this.belongsTo(models.User, {as: 'user_details', foreignKey: 'userId'});
        this.hasMany(models.Message, {as: 'messages', foreignKey: 'chatId'});
    }

    // Create
    static async createChat( { user, prisoner }) {
        return await this.create({user, prisoner});
    }

    /**
     *  create multiple chats
     *  
     *  @param {array} chatArray  - Array of chat params
     */
    static async createBulkChats(chatArray) {
        return await this.bulkCreate(chatArray, {individualHooks: true, ignoreDuplicates: true});
    }

    /**
     * Get raw chat count
     * @returns {int} 
     */
    static async countChats() {
        const {count} = await this.findAndCountAll();

        return count;
    }

    // Read

    static async readAllChats(full, limit, offset = 0) {
        let filters = {limit, offset};
        let options;
        if (full) {
            options = {
                include: [
                    {
                        model: Message,
                        as: 'messages',
                        key: 'chat_key'
                    },
                    {
                        model: User,
                        as: 'user_details'
                    },
                    {
                        model: Prisoner,
                        as: 'prisoner_details'
                    }
                ]
            };
        }
        filters = {...filters, ...options};
        return await Chat.findAll(filters);
    }

    static async readChatsByUser(id, full) {
        const userExists = await User.findByPk(id);
        console.log(userExists);
        if (!userExists) {
            throw new Error('User does not exist');
        }
        if (full) {
            options = {
                where: {user: id},
                include: [
                    {
                        model: Message,
                        as: 'messages',
                        key: 'chat_key'
                    },
                    {
                        model: User,
                        as: 'user_details'
                    },
                    {
                        model: Prisoner,
                        as: 'prisoner_details'
                    }
                ]
            };
        }
        filters = {...filters, ...options};
        return await Chat.findAll(filters);
    }

    static async readChatsByPrisoner(id, full) {
        const prisonerExists = await Prisoner.findByPk(id);
        if (!prisonerExists) {
            throw new Error('Prisoner does not exist');
        }
        if (full) {
            options = {
                where: {prisoner: id},
                include: [
                    {
                        model: Message,
                        as: 'messages',
                        key: 'chat_key'
                    },
                    {
                        model: User,
                        as: 'user_details'
                    },
                    {
                        model: Prisoner,
                        as: 'prisoner_details'
                    }
                ]
            };
        }
        filters = {...filters, ...options};
        return await Chat.findAll(filters);
    }

    static async readChatByUserAndPrisoner(user, prisoner, full) {
        if (full) {
            return await this.findOne({
                where: {user: user, prisoner: prisoner},
                include: [
                    {
                        model: Message,
                        as: 'messages',
                        key: 'chat_key'
                    },
                    {
                        model: User,
                        as: 'user_details'
                    },
                    {
                        model: Prisoner,
                        as: 'prisoner_details'
                    }
                ]
            });
        } else {
            return await this.findOne({
                where: {user: user, prisoner: prisoner}
            });
        }
    }

    static async readChatById(id, full) {
        if (full) {
            return await this.findAll({
                where: {id: id},
                include: [
                    {
                        model: Message,
                        as: 'messages'
                    },
                    {
                        model: User,
                        as: 'user'
                    },
                    {
                        model: Prisoner,
                        as: 'prisoner'
                    }
                ]
            });
        } else {
            return await this.findAll({
                where: {id: id}
            })
        }
    }

    static async findOrCreateChat(user, prisoner) {
        return await this.findOrCreate({where: {user: user, prisoner: prisoner}, defaults: {user: user, prisoner: prisoner}, paranoid: false});
    }

// Update

    static async updateChat(chat) {
        return await this.update(chat, { where: { id: chat.id } });
    }
// Delete

    static async deleteChat(id) {
        var destroyedChats = 0;
        await Message.destroy({
            where: {
                chat: id
            }
        }).then(await this.destroy({where: {id: id}}).then(dc => {
            destroyedChats = dc
        }));
        return destroyedChats;
    }
}
