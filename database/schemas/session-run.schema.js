import { DataTypes } from 'sequelize';

/**
 * A span of time in which this database issued tokens: from the first token
 * of a server run to the latest one. Milliseconds since the epoch, to match
 * the `issued` claim.
 */
const sessionRunSchema = {
	startedAt: {
		type: DataTypes.BIGINT,
		allowNull: false
	},
	lastIssuedAt: {
		type: DataTypes.BIGINT,
		allowNull: false
	}
};

export default sessionRunSchema;
