import {DataTypes} from 'sequelize';

const ruleSchema = {
  title: {
    type: DataTypes.STRING
  },
  description: {
    type: DataTypes.STRING
  }
};

export default ruleSchema;
