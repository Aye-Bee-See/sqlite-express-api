const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const MessageSchema = {
  chat: {
    type: DataTypes.INTEGER,
    model: 'chats',
    key: 'id'
  },
  messageText: {
    type: DataTypes.STRING,
  },
  sender: {
    type: DataTypes.STRING,
  }
}

module.exports = MessageSchema;