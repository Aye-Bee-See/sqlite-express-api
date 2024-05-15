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
        msg: "Message the chat belongs to must be an Int."
      }
    }
  },
  messageText: {
    type: DataTypes.STRING,
    validate: {
      is: ["^[\w.]+$"]
    }
  },
  sender: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
    isIn: {
      args: [["user", "prisoner"]],
      msg: "Sender must either be user or prisoner."}
    },
    notNull: {
      args: true,
      msg: "Sender field must not be null."
    }

  },
  prisoner: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      isInt: {
        args: true,
        msg: "Prisoner ID must be in INT format."
      },
      notNull: {
        args: true,
        msg: "Prisoner ID must not be null."
      }

  }},
  user: {
    type: DataTypes.INTEGER
  }
}

module.exports = MessageSchema;