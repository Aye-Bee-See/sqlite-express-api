const sequelize = require('sequelize')
const DataTypes = sequelize.DataTypes
const prisonModel = {
  prisonName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  address: {
    type: DataTypes.JSON,
    allowNull: false
  },
  deleted: {
    type: DataTypes.JSON,
    allowNull: false
  }
};

module.exports = prisonModel;