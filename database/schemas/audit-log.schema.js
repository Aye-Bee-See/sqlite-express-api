import { DataTypes } from 'sequelize';

/** Who did what to which record; append-only. */
const auditLogSchema = {
	actor: {
		type: DataTypes.INTEGER
	},
	/** Dotted verb, e.g. prisoner.update, submission.approve, letter.status. */
	action: {
		type: DataTypes.STRING,
		allowNull: false
	},
	resource: {
		type: DataTypes.STRING,
		allowNull: false
	},
	targetId: {
		type: DataTypes.INTEGER
	},
	details: {
		type: DataTypes.JSON
	}
};

export default auditLogSchema;
