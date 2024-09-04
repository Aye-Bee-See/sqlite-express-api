import sequelize from 'sequelize';
const DataTypes = sequelize.DataTypes;

export const ChatSchema = {
  user: {
    type: DataTypes.INTEGER,
    model: 'users',
    
  },
  prisoner: {
    type: DataTypes.INTEGER,
    model: 'prisoners',
  }
};
