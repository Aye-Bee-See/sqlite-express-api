const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const ruleSchema = {
  prison: {
    type: DataTypes.INTEGER,
    model: 'prisons',
    key: 'id'
  },
  title: {
    type: DataTypes.STRING
  },
  description: {
    type: DataTypes.STRING
  }
}

module.exports = ruleSchema;