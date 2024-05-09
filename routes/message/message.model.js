const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const MessageSchema = {
  chat: {
    type: DataTypes.INTEGER,
    model: 'chats',
    key: 'chat_key',
    allowNull: false,
    validate: {
      notNull: {
        msg: "Message must belong to chat."
      },
      isInt: {
        msg: "Message the chat belongs to must be an Int"
      }
    }
  },
  messageText: {
    type: DataTypes.STRING,
  },
  sender: {
    type: DataTypes.STRING,
  },
  prisoner: {
    type: DataTypes.INTEGER
  },
  user: {
    type: DataTypes.INTEGER
  }
}

module.exports = MessageSchema;