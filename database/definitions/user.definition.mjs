import * as userSchema from '../models/user.model.js';
import { Model } from 'sequelize';
import {connection} from '../connection.mjs'

class User extends Model {}
console.log(connection);
User.init(
userSchema,
  {
    modelName: 'User',
  },
); 


export {User};