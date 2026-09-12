import { DataTypes } from 'sequelize';
import { LETTER_STATUSES } from '#db/letter-status.js';

const messageSchema = {
	chat: {
		type: DataTypes.INTEGER,
		allowNull: false,
		validate: {
			isInt: {
				args: true,
				msg: 'Message the chat belongs to must be an Int.'
			},
			notNull: {
				args: true,
				msg: 'Message must belong to chat.'
			}
		}
	},
	/** The letter body. Virtual: stored encrypted in ciphertext/nonce. */
	messageText: {
		type: DataTypes.VIRTUAL
	},
	ciphertext: {
		type: DataTypes.TEXT
	},
	nonce: {
		type: DataTypes.STRING
	},
	sender: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: {
				args: [['user', 'prisoner']],
				msg: 'Sender must either be user or prisoner.'
			}
		},
		notNull: {
			args: true,
			msg: 'Sender field must not be null.'
		}
	},
	prisoner: {
		type: DataTypes.INTEGER,
		allowNull: false,
		//   references: {
		//        model: Prisoner,
		//        key: 'id'
		//    },
		validate: {
			isInt: {
				args: true,
				msg: 'Prisoner ID must be in INT format.'
			},
			notNull: {
				args: true,
				msg: 'Prisoner ID must not be null.'
			}
		}
	},
	/** Lifecycle: queued -> printed -> mailed for letters; received for replies. */
	status: {
		type: DataTypes.STRING,
		allowNull: false,
		defaultValue: 'queued',
		validate: {
			isIn: {
				args: [LETTER_STATUSES],
				msg: 'Status must be one of ' + LETTER_STATUSES.join(', ') + '.'
			}
		}
	},
	/** The group that prints and mails this letter (one of the facility's relay groups). */
	relayChapter: {
		type: DataTypes.INTEGER
	},
	/** Instructions for the relay group; never shown to the prisoner. Virtual: stored encrypted. */
	relayNote: {
		type: DataTypes.VIRTUAL
	},
	relayNoteCiphertext: {
		type: DataTypes.TEXT
	},
	relayNoteNonce: {
		type: DataTypes.STRING
	},
	statusChangedAt: {
		type: DataTypes.DATE
	},
	statusChangedBy: {
		type: DataTypes.INTEGER
	},
	user: {
		type: DataTypes.INTEGER,
		allowNull: false,
		//    references: {
		//        model: User,
		//        key: 'id'
		//    },
		validate: {
			isInt: {
				args: true,
				msg: 'User ID must be in INT format.'
			},
			notNull: {
				args: true,
				msg: 'User ID must not be null.'
			}
		}
	}
};

export default messageSchema;
