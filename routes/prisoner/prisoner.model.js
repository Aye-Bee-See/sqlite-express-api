const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const prisonerSchema = {
  birthName: {
    type: DataTypes.STRING
  },
  chosenName: {
    type: DataTypes.STRING
  },
  prison: {
    type: DataTypes.INTEGER,
    model: 'prisons',
    key: 'id'
  },
  inmateID: {
    type: DataTypes.STRING
  },
  releaseDate: {
    type: DataTypes.DATE
  },
  bio: {
    type: DataTypes.STRING
  }
}

module.exports = prisonerSchema;