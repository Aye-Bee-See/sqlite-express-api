import {DataTypes} from 'sequelize';


const prisonSchema={
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

export default prisonSchema;
