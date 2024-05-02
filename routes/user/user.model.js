const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const userSchema = {
  name: {
    type: DataTypes.STRING,
  },
  password: {
    type: DataTypes.STRING,
  },
  email: {
    type: DataTypes.STRING,
  },
  role: {
    type: DataTypes.STRING,
  }
}

module.exports = userSchema