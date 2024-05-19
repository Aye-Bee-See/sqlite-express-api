const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

//TODO: validate prison_id to make sure it associates to an existing prison

const prisonerSchema = {
  birthName: {
    type: DataTypes.STRING
  },
  chosenName: {
    type: DataTypes.STRING
  },
  prison_id: {
    type: DataTypes.INTEGER,
    model: 'prisons',
    key: 'prison_key'
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