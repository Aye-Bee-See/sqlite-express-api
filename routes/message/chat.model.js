const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const ChatSchema = {
  user: {
    type: DataTypes.INTEGER,
  },
  prisoner: {
    type: DataTypes.INTEGER
  }
}

module.exports = ChatSchema