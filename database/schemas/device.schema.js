import { DataTypes } from 'sequelize';

/** Push services the API can send through. */
export const PUSH_PROVIDERS = ['fcm'];
export const DEVICE_PLATFORMS = ['android', 'ios', 'web'];

/** One signed-in device that wants to be woken when something happens. */
const deviceSchema = {
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	provider: {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'fcm',
		validate: {
			isIn: {
				args: [PUSH_PROVIDERS],
				msg: 'provider must be one of ' + PUSH_PROVIDERS.join(', ') + '.'
			}
		}
	},
	platform: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: {
				args: [DEVICE_PLATFORMS],
				msg: 'platform must be one of ' + DEVICE_PLATFORMS.join(', ') + '.'
			}
		}
	},
	/** The push service's address for this app on this device. A capability: never returned by the API. */
	token: {
		type: DataTypes.TEXT,
		allowNull: false,
		unique: true,
		validate: {
			len: { args: [16, 4096], msg: 'token must be 16 to 4096 characters.' }
		}
	},
	/** What the person calls it, to tell their devices apart. */
	label: {
		type: DataTypes.STRING,
		validate: {
			len: { args: [0, 80], msg: 'label must be at most 80 characters.' }
		}
	},
	muted: {
		type: DataTypes.BOOLEAN,
		allowNull: false,
		defaultValue: false
	},
	/** The `jti` of the session that registered it, so signing out there stops its pushes. */
	sessionId: {
		type: DataTypes.STRING
	},
	lastSeenAt: {
		type: DataTypes.DATE
	}
};

export default deviceSchema;
