import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#hooks/all.hooks.mjs';


export default class Message extends Model {
    static init(sequelize) {
        return super.init(
                Schemas.message,
                {
                    sequelize,
                    hooks: Hooks.message || null,
                    modelName: 'Message'
                }
        );
    }
    static associate(models) {
        this.belongsTo(models.Chat, {as: 'ownerChat', foreignKey: 'chat_key'});
    }

//  Create
    static async createMessage(chat, messageText, sender) {
        return await this.create(chat, messageText, sender);
    }

// Read
    static async readAllMessages() {
        return await this.findAll();
    }

    static async readMessageById(id) {
        return await this.findAll({
            where: {id: id}
        });
    }

    static async readMessagesByChat(id) {
        return await this.findAll({
            where: {chat: id}
        });
    }

    static async readMessagesByPrisoner(id) {
        return await this.findAll({
            where: {prisoner: id}
        });
    }

    static async readMessagesByUser(id) {
        return await this.findAll({
            where: {user: id}
        });
    }


// Update

    static async updateMessage(message) {
        return await this.update({...message}, {where: {id: message.id}});
    }

// Delete

    static async deleteMessage(id) {
        return await this.destroy({
            where: {id: id},
            force: true
        })
    }

}
