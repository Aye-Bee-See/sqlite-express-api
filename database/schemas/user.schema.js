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
