import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';
import {
	CHAPTER_SERVICES,
	SOCIAL_LINK_KEYS,
	arrayFrom,
	objectOfStrings,
	NETWORK_ROLES,
	ACCOUNT_STATUSES
} from '#db/validators.js';

const chapterSchema = {
	name: {
		type: DataTypes.STRING,
		allowNull: false
	},
	location: {
		type: DataTypes.JSON,
		allowNull: false
	},
	subregion: {
		type: DataTypes.STRING
	},
	country: {
		type: DataTypes.STRING
	},
	about: {
		type: DataTypes.TEXT
	},
	website: {
		type: DataTypes.STRING,
		validate: { isUrl: { msg: 'Website must be a valid URL.' } }
	},
	email: {
		type: DataTypes.STRING,
		validate: { isEmail: { msg: 'Email must be in traditional email format. E.g. x@y.z' } }
	},
	socialLinks: {
		type: DataTypes.JSON,
		validate: objectOfStrings('Social links', SOCIAL_LINK_KEYS)
	},
	services: {
		type: DataTypes.JSON,
		validate: arrayFrom('Services', CHAPTER_SERVICES)
	},
	announcement: {
		type: DataTypes.TEXT
	},
	/** X25519 public key of the group (e2e mode), base64. */
	publicKey: {
		type: DataTypes.STRING
	},
	/** Which keypair this is: 0 before the group has keys, 1 at set-up, +1 per rotation. */
	keyVersion: {
		type: DataTypes.INTEGER,
		allowNull: false,
		defaultValue: 0
	},
	keyRotatedAt: {
		type: DataTypes.DATE
	},
	/** collecting, relay, or both. */
	networkRole: {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'collecting',
		validate: {
			isIn: {
				args: [NETWORK_ROLES],
				msg: 'Network role must be one of ' + NETWORK_ROLES.join(', ') + '.'
			}
		}
	},
	/** pending until an admin approves the group; only active groups may act. */
	accountStatus: {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'pending',
		validate: {
			isIn: {
				args: [ACCOUNT_STATUSES],
				msg: 'Account status must be one of ' + ACCOUNT_STATUSES.join(', ') + '.'
			}
		}
	},
	vouchedBy: {
		type: DataTypes.INTEGER
	},
	/** @deprecated superseded by the PrisonerSupport relation; kept for compatibility */
	prisoners: {
		type: DataTypes.JSON
	},
	lettersSent: {
		type: DataTypes.STRING
	},
	averageTimeDays: {
		type: DataTypes.INTEGER
	},
	recordStatus: {
		type: DataTypes.STRING,
		...recordStatusAttribute
	}
};

export default chapterSchema;
