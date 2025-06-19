import { DataTypes } from 'sequelize';

const ruleSchema = {
	title: {
		type: DataTypes.STRING,
		allowNull: false
	},
	description: {
		type: DataTypes.STRING
	}
};

export default ruleSchema;
