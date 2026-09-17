import { DataTypes } from 'sequelize';

/** `group`: a new group joins, vouched for by `chapterId`. `member`: a person joins group `chapterId`. */
export const INVITATION_KINDS = ['group', 'member'];

/** Stored states. `expired` is not stored: it is a pending invitation past `expiresAt`. */
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked'];

const invitationSchema = {
	kind: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: {
				args: [INVITATION_KINDS],
				msg: 'kind must be one of ' + INVITATION_KINDS.join(', ') + '.'
			}
		}
	},
	/** The vouching group (kind group; null when an admin invites) or the group being joined (kind member). */
	chapterId: {
		type: DataTypes.INTEGER
	},
	inviteeName: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			len: { args: [1, 120], msg: 'inviteeName must be 1 to 120 characters.' }
		}
	},
	/** A contact note for the inviter. The API never sends mail. */
	inviteeEmail: {
		type: DataTypes.STRING,
		validate: {
			isEmail: { msg: 'inviteeEmail must be an email address.' }
		}
	},
	note: {
		type: DataTypes.TEXT
	},
	tokenHash: {
		type: DataTypes.STRING,
		allowNull: false,
		unique: true
	},
	expiresAt: {
		type: DataTypes.DATE,
		allowNull: false
	},
	status: {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'pending',
		validate: {
			isIn: {
				args: [INVITATION_STATUSES],
				msg: 'status must be one of ' + INVITATION_STATUSES.join(', ') + '.'
			}
		}
	},
	invitedBy: {
		type: DataTypes.INTEGER
	},
	acceptedAt: {
		type: DataTypes.DATE
	},
	acceptedUser: {
		type: DataTypes.INTEGER
	},
	/** kind group: the group the acceptance created. */
	createdChapter: {
		type: DataTypes.INTEGER
	}
};

export default invitationSchema;
