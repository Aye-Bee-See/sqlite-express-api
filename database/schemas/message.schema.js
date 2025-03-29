import {DataTypes} from 'sequelize';
import {Chat,Prisoner} from "#models/all.model.mjs";

const messageSchema = {
  chat: {
    type: DataTypes.INTEGER,
    model: "Chat",
    allowNull: false,
    validate: {
      isInt: {
          args: true,
        msg: "Message the chat belongs to must be an Int."
      },
      notNull: {
          args: true,
        msg: "Message must belong to chat."
      }
    } 
  },
  messageText: {
    type: DataTypes.STRING,
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
//   references: {
//        model: Prisoner,
//        key: 'id'
//    },
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
    type: DataTypes.INTEGER,
    allowNull: false,
//    references: {
//        model: User,
//        key: 'id'
//    },
    validate: {
      isInt: {
        args: true,
        msg: "User ID must be in INT format."
      },
      notNull: {
        args: true,
        msg: "User ID must not be null."
      }
    }
  },
  image: {
    type: DataTypes.STRING
  }
};

export default messageSchema;
