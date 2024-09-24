import {DataTypes} from 'sequelize';

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
  },
  status: {
    type: DataTypes.STRING,
    isIn: {
      args: [['pending, pretrial', 'incarcerated', 'free']],
      msg: "Status must be pretrial, incarcerated, or free."
    }
  }
};
export default prisonerSchema;
