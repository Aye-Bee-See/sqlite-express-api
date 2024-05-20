const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const ChatSchema = {
  user: {
    type: DataTypes.INTEGER,
    model: 'users',
    
  },
  prisoner: {
    type: DataTypes.INTEGER,
    model: 'prisoners',
  }
}

module.exports = ChatSchema