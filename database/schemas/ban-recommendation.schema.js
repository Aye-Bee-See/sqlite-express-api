import { DataTypes } from 'sequelize';

/** pending until a superadmin decides; then banned or dismissed. */
export const BAN_RECOMMENDATION_STATUSES = ['pending', 'banned', 'dismissed'];

/** A group admin's recommendation that a writer be blocked site-wide. */
const banRecommendationSchema = {
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	/** The group the recommendation came from. */
	chapterId: {
		type: DataTypes.INTEGER
	},
	recommendedBy: {
		type: DataTypes.INTEGER
	},
	/** Why, for the superadmin who decides: at most 1000 characters. Not shown to the writer. */
	reason: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: { len: { args: [1, 1000], msg: 'reason must be 1 to 1000 characters.' } }
	},
	status: {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'pending',
		validate: {
			isIn: {
				args: [BAN_RECOMMENDATION_STATUSES],
				msg: 'status must be one of ' + BAN_RECOMMENDATION_STATUSES.join(', ') + '.'
			}
		}
	},
	decidedBy: {
		type: DataTypes.INTEGER
	},
	decidedAt: {
		type: DataTypes.DATE
	},
	/** The superadmin's few words back to the group: at most 500 characters. */
	decisionNote: {
		type: DataTypes.STRING,
		validate: { len: { args: [0, 500], msg: 'note can be at most 500 characters.' } }
	}
};

export default banRecommendationSchema;
