import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';
import { arrayOfStrings } from '#db/validators.js';

/** What changes when a photo does: its upload time, in milliseconds. Also its ETag. */
export function photoVersion(addedAt) {
	const time = addedAt ? new Date(addedAt).getTime() : 0;
	return String(Number.isFinite(time) ? time : 0);
}

const prisonerSchema = {
	birthName: {
		type: DataTypes.STRING
	},
	chosenName: {
		type: DataTypes.STRING
	},
	aliases: {
		type: DataTypes.JSON,
		validate: arrayOfStrings('Aliases')
	},
	prison: {
		type: DataTypes.INTEGER
	},
	country: {
		type: DataTypes.STRING
	},
	inmateID: {
		type: DataTypes.STRING
	},
	releaseDate: {
		type: DataTypes.DATE
	},
	detainedSince: {
		type: DataTypes.DATE
	},
	sentence: {
		type: DataTypes.STRING
	},
	charges: {
		type: DataTypes.TEXT
	},
	estimatedRelease: {
		type: DataTypes.STRING
	},
	bio: {
		type: DataTypes.STRING
	},
	interests: {
		type: DataTypes.JSON,
		validate: arrayOfStrings('Interests')
	},
	/**
	 * A photo hosted here: the stored file, who put it there, and the credit line.
	 * The file's name on disk and the uploader's id are never sent to anyone:
	 * their getters answer nothing, so no row, bare or nested in another record,
	 * carries them. Code that needs them reads `getDataValue`.
	 */
	photoFile: {
		type: DataTypes.STRING,
		get() {
			return undefined;
		}
	},
	photoCredit: {
		type: DataTypes.STRING,
		validate: {
			len: { args: [0, 200], msg: 'Photo credit can be at most 200 characters.' }
		}
	},
	photoAddedAt: {
		type: DataTypes.DATE
	},
	photoAddedBy: {
		type: DataTypes.INTEGER,
		get() {
			return undefined;
		}
	},
	/**
	 * The one field a client needs to show a face, or null when there is none.
	 * Every photo is hosted here (there is no longer a link to one hosted
	 * elsewhere), so `hosted` is always true; it is kept so that a client written
	 * against the older shape does not have to change to keep working. The `v`
	 * in the URL changes with every upload, so an image cache keyed by URL (as
	 * the phone clients' are) fetches a replaced photo rather than showing the old.
	 */
	photo: {
		type: DataTypes.VIRTUAL,
		get() {
			const file = this.getDataValue('photoFile');
			if (!file) {
				return null;
			}
			return {
				url:
					'/prisoner/photo?prisoner=' +
					this.getDataValue('id') +
					'&v=' +
					photoVersion(this.getDataValue('photoAddedAt')),
				hosted: true,
				credit: this.getDataValue('photoCredit') || null,
				updatedAt: this.getDataValue('photoAddedAt')
			};
		}
	},
	supportWebsite: {
		type: DataTypes.STRING,
		validate: { isUrl: { msg: 'Support website must be a valid URL.' } }
	},
	donationInfo: {
		type: DataTypes.TEXT
	},
	status: {
		type: DataTypes.STRING,
		validate: {
			isIn: {
				args: [['pretrial', 'incarcerated', 'free']],
				msg: 'Status must be pretrial, incarcerated, or free.'
			}
		}
	},
	statusNotice: {
		type: DataTypes.STRING
	},
	featured: {
		type: DataTypes.BOOLEAN,
		allowNull: false,
		defaultValue: false
	},
	verifiedBy: {
		type: DataTypes.INTEGER
	},
	verifiedAt: {
		type: DataTypes.DATE
	},
	verificationNotes: {
		type: DataTypes.TEXT
	},
	recordStatus: {
		type: DataTypes.STRING,
		...recordStatusAttribute
	}
};
export default prisonerSchema;
