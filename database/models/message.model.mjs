import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#db/hooks/all.hooks.mjs';


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
}
