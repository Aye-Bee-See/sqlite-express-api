import { DataTypes } from 'sequelize';

const userSchema = {
	name: {
		type: DataTypes.STRING,
		validate: {
			len: {
				args: [3, 32],
				msg: 'Name must be between 3 and 32 characters.'
			}
		}
	},

	username: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			len: {
				args: [3, 16],
				msg: 'Username must be between 3 and 16 characters.'
			},
			notNull: {
				msg: 'Username cannot be null.'
			}
		},
		unique: {
			args: true,
			msg: 'Username already in use.'
		}
	},

	password: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			notNull: {
				msg: 'Password cannot be null.'
			},
			len: {
				args: [7, 255],
				msg: 'Password must be a minimum of 7 characters.'
			}
		}
	},

	email: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isEmail: {
				msg: 'Email must be in traditional email format. E.g. x@y.z'
			},
			notNull: {
				msg: 'Email cannot be null.'
			}
		},
		unique: {
			args: true,
			msg: 'Email address already in use.'
		}
	},

	bio: {
		type: DataTypes.TEXT,
		validate: {
			len: {
				args: [12, 2400],
				msg: 'Bio must be between 12 and 2400 characters.'
			}
		}
	},

	chapterId: {
		type: DataTypes.INTEGER
	},

	/** Chapter holding this account in custody (a managed writer); null once claimed or for independent accounts. */
	managedBy: {
		type: DataTypes.INTEGER
	},
	claimedAt: {
		type: DataTypes.DATE
	},
	claimedFrom: {
		type: DataTypes.INTEGER
	},
	/** Set on the one anonymous-writer account each chapter gets. */
	anonymousForChapter: {
		type: DataTypes.INTEGER
	},
	/** Internal note, visible to the managing chapter and admins only. */
	managerNote: {
		type: DataTypes.TEXT
	},

	/** Tokens issued before this instant are refused (logout everywhere, revocation, password change). */
	sessionsRevokedAt: {
		type: DataTypes.DATE
	},

	// End-to-end key material (opaque to the server; see services/crypto.js).
	/** X25519 public key, base64. Public. */
	publicKey: {
		type: DataTypes.STRING
	},
	/** Private key wrapped with the password-derived key. */
	wrappedPrivateKey: {
		type: DataTypes.TEXT
	},
	kdfSalt: {
		type: DataTypes.STRING
	},
	kdfParams: {
		type: DataTypes.JSON
	},
	/** Private key wrapped with the recovery-code-derived key. */
	recoveryWrappedPrivateKey: {
		type: DataTypes.TEXT
	},
	recoverySalt: {
		type: DataTypes.STRING
	},
	recoveryKdfParams: {
		type: DataTypes.JSON
	},
	/** Managed writers: private key sealed to the managing group, until claimed. */
	orgWrappedPrivateKey: {
		type: DataTypes.TEXT
	},
	/** Recovery challenge in flight: hash of the sealed nonce, and when it lapses. */
	recoveryChallengeHash: {
		type: DataTypes.STRING
	},
	recoveryChallengeExpiresAt: {
		type: DataTypes.DATE
	},

	role: {
		type: DataTypes.STRING,
		allowNull: false,
		validate: {
			isIn: {
				args: [['admin', 'user', 'chapter', 'banned']],
				msg: 'Role must be one of admin, user, chapter, or banned.'
			}
		}
	}
};

export default userSchema;
