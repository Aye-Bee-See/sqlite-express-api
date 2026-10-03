import { DataTypes } from 'sequelize';
import {
	LETTER_STATUSES,
	RETURN_REASONS,
	DECLINE_REASONS,
	HELD_REASONS
} from '#db/letter-status.js';

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
	/**
	 * Written by hand and handed to the relay group to mail: nothing to print,
	 * so it starts as `printed`. Set on create only.
	 */
	paper: {
		type: DataTypes.BOOLEAN,
		allowNull: false,
		defaultValue: false
	},
	/** Nine digits printed in the letter's footer; a reply carries it back. Issued by the server, read-only. */
	replyReference: {
		type: DataTypes.STRING
	},
	/** For a reply filed by reference: the letter it answers (null once that letter is gone). */
	repliesTo: {
		type: DataTypes.INTEGER
	},
	/** Pinned: exempt from the retention purge. */
	keep: {
		type: DataTypes.BOOLEAN,
		allowNull: false,
		defaultValue: false
	},
	statusChangedBy: {
		type: DataTypes.INTEGER
	},
	/** Why a `returned` letter came back (RETURN_REASONS); null otherwise. Set with the status, never directly. */
	returnReason: {
		type: DataTypes.STRING,
		validate: {
			isIn: {
				args: [RETURN_REASONS],
				msg: 'reason must be one of ' + RETURN_REASONS.join(', ') + '.'
			}
		}
	},
	/** What the envelope said when it came back, as typed by the group (at most 200 characters); set with the status, never directly. */
	returnNote: {
		type: DataTypes.STRING,
		validate: { len: { args: [0, 200], msg: 'note can be at most 200 characters.' } }
	},
	/** Why the relay group declined to mail it (DECLINE_REASONS); null otherwise. Set with the status, never directly. */
	declineReason: {
		type: DataTypes.STRING,
		validate: {
			isIn: {
				args: [DECLINE_REASONS],
				msg: 'reason must be one of ' + DECLINE_REASONS.join(', ') + '.'
			}
		}
	},
	/** For a `facility_rule` decline: the tag of the facility's mail rule it would break. */
	declineRule: {
		type: DataTypes.STRING
	},
	/**
	 * For a `facility_rule` decline: the rule's label as it read when the group
	 * declined, so the writer is told the same words after the rule is renamed,
	 * retired, or deleted. Set with the status, never directly.
	 */
	declineRuleLabel: {
		type: DataTypes.STRING
	},
	/**
	 * For a decline: a few words to the writer from the volunteer who made it, at
	 * most 200 characters. Not encrypted in any mode: it says why, and must not
	 * quote the letter.
	 */
	declineNote: {
		type: DataTypes.STRING,
		validate: { len: { args: [0, 200], msg: 'note can be at most 200 characters.' } }
	},
	/** Why a queued letter is held (HELD_REASONS), set by the server when its prisoner is moved or freed; null otherwise. */
	heldReason: {
		type: DataTypes.STRING,
		validate: {
			isIn: {
				args: [HELD_REASONS],
				msg: 'heldReason must be one of ' + HELD_REASONS.join(', ') + '.'
			}
		}
	},
	/** The returned letter this one was sent again for, if any. */
	resendOf: {
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
