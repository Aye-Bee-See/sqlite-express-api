import { DataTypes } from 'sequelize';

export const SUBMISSION_RESOURCES = ['prisoner', 'prison', 'chapter'];
export const SUBMISSION_KINDS = ['create', 'update'];
export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'];

/**
 * A proposed new directory record or a proposed change to one, waiting for
 * an admin to approve (possibly with edits), reject, or for the submitter
 * to withdraw.
 */
const submissionSchema = {
	resource: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: {
				args: [SUBMISSION_RESOURCES],
				msg: 'Resource must be one of ' + SUBMISSION_RESOURCES.join(', ') + '.'
			}
		}
	},
	kind: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: {
				args: [SUBMISSION_KINDS],
				msg: 'Kind must be one of ' + SUBMISSION_KINDS.join(', ') + '.'
			}
		}
	},
	/** The existing record for an update; the created record's id once a create is approved. */
	targetId: {
		type: DataTypes.INTEGER
	},
	/** The proposed field values. */
	payload: {
		type: DataTypes.JSON,
		allowNull: false
	},
	/** Where the submitter got this: links, documents, "I am their lawyer". */
	evidence: {
		type: DataTypes.TEXT
	},
	note: {
		type: DataTypes.TEXT
	},
	status: {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'pending',
		validate: {
			isIn: {
				args: [SUBMISSION_STATUSES],
				msg: 'Status must be one of ' + SUBMISSION_STATUSES.join(', ') + '.'
			}
		}
	},
	submittedBy: {
		type: DataTypes.INTEGER
	},
	reviewedBy: {
		type: DataTypes.INTEGER
	},
	reviewedAt: {
		type: DataTypes.DATE
	},
	decisionNote: {
		type: DataTypes.TEXT
	},
	/** What was actually written on approval (the payload plus any reviewer edits). */
	appliedChanges: {
		type: DataTypes.JSON
	}
};

export default submissionSchema;
