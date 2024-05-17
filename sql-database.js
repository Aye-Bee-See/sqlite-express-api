// TODO: Make sure there are CRUD functions for all models
/*const prisonSchema = require('./models/prison.model');
const userSchema = require('./models/user.model');
const prisonerSchema = require('./models/prisoner.model');
const chatSchema = require('./models/chat.model');
const messageSchema = require('./models/message.model');
const ruleSchema = require('./models/rule.model');
const Sequelize = require('sequelize');

const sequelize = new Sequelize({
  database: 'users_db',
  username: 'root',
  password: '',
  dialect: 'sqlite',
  storage: 'database.sqlite'
});

sequelize
  .authenticate()
  .then(() => console.log('Connection to admin-db has been established successfully.'))
  .catch(err => console.error('Unable to connect to the database:', err));

// import models
const User = sequelize.define('user', userSchema);
User.addHook("beforeCreate", "HashPass", async (record, options) => {
    const {hash} = require('bcrypt');
      const hashedPass = await hash(record.password, 10);
      record.password =hashedPass;
});
const Prison = sequelize.define('prison', prisonSchema);
const Prisoner = sequelize.define('prisoner', prisonerSchema);
const Chat = sequelize.define('chat', chatSchema);
const Message = sequelize.define('message', messageSchema);
const Rule = sequelize.define('rule', ruleSchema);

Prisoner.belongsTo(Prison, { as: 'prison', foreignKey: 'prison_id', sourceKey: 'prison' });
Prisoner.hasMany(Chat, { as: 'chats', foreignKey: 'prisoner_key' });

Prison.hasMany(Prisoner, { as: 'prisoners', foreignKey: 'prison_id' });
Prison.hasMany(Rule, { as: 'rules', foreignKey: 'id' });

Message.belongsTo(Chat, { as: 'ownerChat', foreignKey: 'chat_key' });

User.hasMany(Chat, { as: 'chats', foreignKey: 'user_key' });

Chat.belongsTo(Prisoner, { as: 'prisonerDetails', foreignKey: 'id', sourceKey: 'prisoner' });
Chat.belongsTo(User, { as: 'userDetails', foreignKey: 'id', sourceKey: 'user' });
Chat.hasMany(Message, { as: 'messages', foreignKey: 'chat_key' } );

// Force: True resets database
// TODO: Make this only force in dev environment
sequelize.sync({ force: true }).then(async() => {
    const seeds =  await import ('./database/seeds/seeds.mjs');
    return await seeds.createSeeds();
});

module.exports = {  Prison, Prisoner, User, Rule, Message, Chat };
 * 
 */