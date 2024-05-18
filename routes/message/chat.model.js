const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const ChatSchema = {
  user: {
    type: DataTypes.INTEGER,
    model: "users",
    key: 'user_key'
  },
  prisoner: {
    type: DataTypes.INTEGER,
    model: 'prisoners',
    key: 'prisoner_key'
  }
}

module.exports = ChatSchema