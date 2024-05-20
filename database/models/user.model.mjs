import  userSchema from '#schemas/user.schema.js';
import { Model } from 'sequelize';
import  userHooks from "#db/hooks/user.hooks.mjs";

console.log(userSchema);

export default class User extends Model {
    static init(sequelize) {
        return super.init(
                userSchema,
                {
                    sequelize,
                    hooks: userHooks || null,
                    modelName: 'User'
                }
        );
    }

}