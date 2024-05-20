import {Sequelize, Model} from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#db/hooks/all.hooks.mjs';
import UserModel from "#models/user.model.mjs";
//import {createSeeds} from './seeds/all.seeds.mjs';

//const {DB_USER, DB_PASS, DB_NAME} = process.env;

const config = {
    database: 'users_db',
    username: 'root',
    password: '',
    dialect: 'sqlite',
    storage: 'database.sqlite'
};

//console.log("CONF: " + JSON.stringify(config));
export const sequelize= new Sequelize(config);

export const User = UserModel.init(sequelize, Sequelize);
export class Chat extends Model {}
Chat.init(
Schemas.chat,
  {
    modelName: 'Chat',
    hooks: Hooks.chat ||null,
    sequelize
  },
); 

export class Message extends Model {}
Message.init(
Schemas.message,
  {
    modelName: 'Message',
    hooks: Hooks.message || null,
    sequelize
  },
); 

export class Rule extends Model {}
Rule.init(
Schemas.rule,
  {
    modelName: 'Rule',
    hooks: Hooks.rule || null,
    sequelize
  },
); 

export class Prison extends Model {}
Prison.init(
Schemas.prison,
  {
    modelName: 'Prison',
    hooks: Hooks.prison || null,
    sequelize
  },
); 

export class Prisoner extends Model {}
Prisoner.init(
Schemas.prisoner,
  {
    modelName: 'Prisoner',
    hooks: Hooks.prisoner || null,
    sequelize
  },
); 

    Prisoner.belongsTo(Prison, {as: 'prison', foreignKey: 'prison_id', sourceKey: 'prison'});
    Prisoner.hasMany(Chat, {as: 'chats', foreignKey: 'prisoner_key'});

    Prison.hasMany(Prisoner, {as: 'prisoners', foreignKey: 'prison_id'});
    Prison.hasMany(Rule, {as: 'rules', foreignKey: 'id'});

    Message.belongsTo(Chat, {as: 'ownerChat', foreignKey: 'chat_key'});

    User.hasMany(Chat, {as: 'chats', foreignKey: 'user_key'});

    Chat.belongsTo(Prisoner, {as: 'prisonerDetails', foreignKey: 'id', sourceKey: 'prisoner'});
    Chat.belongsTo(User, {as: 'userDetails', foreignKey: 'id', sourceKey: 'user'});
    Chat.hasMany(Message, {as: 'messages', foreignKey: 'chat_key'});

sequelize.sync({ force: true }).then(async() => {
    //return await createSeeds();
});