import { DataTypes } from 'sequelize';

/** What a key may guard. */
export const IDEMPOTENCY_SCOPES = ['message', 'attachment'];

/** 8 to 128 printable ASCII characters without spaces: a UUID fits, and so does most of what clients generate. */
export const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,128}$/;

const idempotencyKeySchema = {
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	scope: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: { isIn: { args: [IDEMPOTENCY_SCOPES], msg: 'Unknown idempotency scope.' } }
	},
	key: {
		type: DataTypes.STRING,
		allowNull: false
	},
	/** A hash of the parts of the request that must match on a retry. Never the request itself. */
	fingerprint: {
		type: DataTypes.STRING,
		allowNull: false
	},
	/** `processing` while the first attempt runs, `done` once it has made something. */
	state: {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'processing'
	},
	/** The id of what the first attempt created. */
	resourceId: {
		type: DataTypes.INTEGER
	}
};

export default idempotencyKeySchema;
