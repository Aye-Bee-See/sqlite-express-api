import {Sequelize, Model} from 'sequelize';
import {Schemas} from './models/all.model';
import {Hooks} from './hooks/all.hooks';

const {DB_USER, DB_PASS, DB_NAME} = process.env;

const config = {
    database: 'users_db',
    username: 'root',
    password: '',
    dialect: 'sqlite',
    storage: 'database.sqlite'
};

console.log("CONF: " + JSON.stringify(config));
export const sequelize= new Sequelize(config);

class User extends Model {}
console.log(connection);
User.init(
Schemas.user,
  {
    modelName: 'User',
    hooks: Hooks.user,
    sequelize
  },
); 
class Chat extends Model {}
Chat.init(
Schemas.chat,
  {
    modelName: 'Chat',
    hooks: Hooks.chat,
    sequelize
  },
); 
class Message extends Model {}
Message.init(
Schemas.message,
  {
    modelName: 'Message',
    hooks: Hooks.message || null,
    sequelize
  },
); 
class Rule extends Model {}
Rule.init(
Schemas.rule,
  {
    modelName: 'Rule',
    hooks: Hooks.rule || null,
    sequelize
  },
); 
class Prison extends Model {}
Prison.init(
Schemas.prison,
  {
    modelName: 'Prison',
    hooks: Hooks.prison || null,
    sequelize
  },
); 
class Prisoner extends Model {}
Prisoner.init(
Schemas.prisoner,
  {
    modelName: 'Prisoner',
    hooks: Hooks.prisoner || null,
    sequelize
  },
); 


