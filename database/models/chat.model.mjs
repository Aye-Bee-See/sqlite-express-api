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
        this.belongsTo(models.Prisoner, { as: 'prisoner_details', foreignKey: 'prisoner' });
        this.belongsTo(models.User, { as: 'user_details', foreignKey: 'user' });
        this.hasMany(models.Message, { as: 'messages', foreignKey: 'chat' });
    }
    
    // Create
    static async createChat( { user, prisoner }) {
        return await this.create({user, prisoner});
    }
    // Read

    static async readAllChats(full) {
        if (full) {
            return await this.findAll({
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
            return await this.findAll({});
        }
    }
    
        static async readChatsByUser(id, full) {
        if (full) {
            return await this.findAll({
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
            });
        } else {
            return await this.findAll({
                where: {user: id}
            })
        }
    }
    
        static async readChatsByPrisoner(id, full) {
        if (full) {
            return await this.findAll({
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
            });
        } else {
            return await this.findAll({
                where: {prisoner: id}
            });
        }
    }
    
        static async readChatsByUserAndPrisoner(user, prisoner, full) {
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
        const user = chat.user;
        const prisoner = chat.prisoner;
        return await this.update({...chat}, {where: {id: chat.id}}).then(updatedChat =>
            this.update({user: user, prisoner: prisoner}, {where: {chat: updatedChat}})
        ).catch()
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