const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const ruleSchema = {
  title: {
    type: DataTypes.STRING
  },
  description: {
    type: DataTypes.STRING
  }
}

module.exports = ruleSchema;