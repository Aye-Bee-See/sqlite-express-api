import { DataTypes } from 'sequelize';
import { recordStatusAttribute } from '#db/record-status.js';
import { arrayOfStrings } from '#db/validators.js';

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
	photoUrl: {
		type: DataTypes.STRING,
		validate: { isUrl: { msg: 'Photo URL must be a valid URL.' } }
	},
	/** A photo hosted here: the stored file, who put it there, and the credit line. */
	photoFile: {
		type: DataTypes.STRING
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
		type: DataTypes.INTEGER
	},
	/**
	 * The one field a client needs to show a face: the hosted photo if there is
	 * one, else the older `photoUrl` link, else null. `hosted` says which, since
	 * only a hosted photo is served from here and known to carry no metadata.
	 */
	photo: {
		type: DataTypes.VIRTUAL,
		get() {
			const file = this.getDataValue('photoFile');
			const link = this.getDataValue('photoUrl');
			if (!file && !link) {
				return null;
			}
			return {
				url: file ? '/prisoner/photo?prisoner=' + this.getDataValue('id') : link,
				hosted: Boolean(file),
				credit: this.getDataValue('photoCredit') || null,
				updatedAt: file ? this.getDataValue('photoAddedAt') : null
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
