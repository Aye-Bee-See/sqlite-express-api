import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#db/hooks/all.hooks.mjs';


export default class Prisoner extends Model {
    static init(sequelize) {
        return super.init(
                Schemas.prisoner,
                {
                    sequelize,
                    hooks: Hooks.prisoner || null,
                    modelName: 'Prisoner'
                }
        );
    }
    static associate(models) {
        this.belongsTo(models.Prison, {as: 'prison', foreignKey: 'prison_id', sourceKey: 'prison'});
        this.hasMany(models.Chat, {as: 'chats', foreignKey: 'prisoner_key'});
    }
}
