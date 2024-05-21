import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#db/hooks/all.hooks.mjs';


export default class Prison extends Model {
    static init(sequelize) {
        return super.init(
                Schemas.prison,
                {
                    sequelize,
                    hooks: Hooks.prison || null,
                    modelName: 'Prison'
                }
        );
    }
    static associate(models) {
        this.hasMany(models.Prisoner, {as: 'prisoners', foreignKey: 'prison_id'});
        this.hasMany(models.Rule, {as: 'rules', foreignKey: 'id'});
    }
}