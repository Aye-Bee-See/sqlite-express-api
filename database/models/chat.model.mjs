import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#db/hooks/all.hooks.mjs';


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
        this.belongsTo(models.Prisoner, {as: 'prisonerDetails', foreignKey: 'id', sourceKey: 'prisoner'});
        this.belongsTo(models.User, {as: 'userDetails', foreignKey: 'id', sourceKey: 'user'});
        this.hasMany(models.Message, {as: 'messages', foreignKey: 'chat_key'});
    }
}