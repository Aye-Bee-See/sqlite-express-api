import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#db/hooks/all.hooks.mjs';


export default class Rule extends Model {
    static init(sequelize) {
        return super.init(
                Schemas.rule,
                {
                    sequelize,
                    hooks: Hooks.rule || null,
                    modelName: 'Rule'
                }
        );
    }

}

