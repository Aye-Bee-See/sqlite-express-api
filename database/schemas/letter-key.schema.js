import { DataTypes } from 'sequelize';

/** Reader types for a letter's content-key envelopes. */
export const READER_TYPES = ['server', 'user', 'chapter'];

/**
 * One envelope per reader of a letter: the letter's content key wrapped so
 * that this reader can open it. `server` rows are wrapped with
 * ENCRYPTION_KEY (readerId null); `user` and `chapter` rows are sealed to
 * that account's or group's public key.
 */
const letterKeySchema = {
	message: {
		type: DataTypes.INTEGER,
		allowNull: false
	},
	readerType: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: {
				args: [READER_TYPES],
				msg: 'Reader type must be one of ' + READER_TYPES.join(', ') + '.'
			}
		}
	},
	readerId: {
		type: DataTypes.INTEGER
	},
	wrappedKey: {
		type: DataTypes.TEXT,
		allowNull: false
	},
	/** Fingerprint of the wrapping key (server rows), so a wrong ENCRYPTION_KEY is reported plainly. */
	keyLabel: {
		type: DataTypes.STRING
	},
	/** Chapter rows: the version of the group key this envelope is sealed to. */
	keyVersion: {
		type: DataTypes.INTEGER
	}
};

export default letterKeySchema;
