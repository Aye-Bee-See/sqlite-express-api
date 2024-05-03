// TODO: Make sure there are CRUD functions for all models
const prisonSchema = require('./routes/prison/prison.model');
const userSchema = require('./routes/user/user.model');
const prisonerSchema = require('./routes/prisoner/prisoner.model');
const chatSchema = require('./routes/message/chat.model');
const messageSchema = require('./routes/message/message.model');
const ruleSchema = require('./routes/rule/rule.model');

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

// create models
const User = sequelize.define('user', userSchema);
const Prison = sequelize.define('prison', prisonSchema)
const Prisoner = sequelize.define('prisoner', prisonerSchema);
const Chat = sequelize.define('chat', chatSchema);
const Message = sequelize.define('message', messageSchema);
const Rule = sequelize.define('rule', ruleSchema);

Prisoner.belongsTo(Prison, { as: 'prison', foreignKey: 'prison_id', sourceKey: 'prison' });
Prisoner.hasMany(Chat, { as: 'chats', foreignKey: 'id', targetKey: 'prisoner' } )

Prison.hasMany(Prisoner, { as: 'prisoners', foreignKey: 'prison_id' });
Prison.hasMany(Rule, { as: 'rules', foreignKey: 'id' });

Message.belongsTo(Chat, { as: 'ownerChat', foreignKey: 'id', sourceKey: 'chat'});

// Chat.hasMany(Message, { as: 'listMessages', foreignKey: 'chat' });
Chat.belongsTo(Prisoner, { as: 'prisonerDetails', foreignKey: 'id', sourceKey: 'prisoner' });
Chat.belongsTo(User, { as: 'userDetails', foreignKey: 'id', sourceKey: 'user' });

// Force: True resets database
// TODO: Make this only force in dev environment
sequelize.sync({ force:true })

module.exports = {  Prison, Prisoner, User, Rule, Message, Chat }