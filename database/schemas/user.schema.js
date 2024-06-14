const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const userSchema = {
  name: {
    type: DataTypes.STRING,
    validate: {
      min: {
        args: [3],
        msg: "Username must be 3 characters or more."
      },
      max: {
        args: [32],
        msg: "Username cannot be more than 16 characters."
      }
    },
  },

  username: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    validate: {
      min: {
        args: [3],
        msg: "Username must be at least 3 characters long."
      },
      max: {
        args: [16],
        msg: "Username must be no more than 16 characters long."
      },
      notNull: {
        msg: "Username cannot be null."
      }
    },
    unique: {
      args: true,
      msg: "Username already in use."
    }
  },

  password: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notNull: {
        msg: "Password cannot be null."
      },
      min: {
        args: [7],
        msg: "Password must be a minimum of 7 characters."
      }
    }
  },

  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isEmail: {
        msg: "Email must be in traditional email format. E.g. x@y.z"
      },
      notNull: {
        msg: "Email cannot be null."
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
      min: {
        args: [12],
        msg: "Bio must be at least 12 characters long."
      },
      max: {
        args: [2400],
        msg: "Bio must be no longer than 2400 characters."
      }
    }
  },

  role: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isIn: {
        args: [['admin', 'user', 'banned']],
        msg: "Role must be either admin, user, or banned."
      }
    }
  }
};

module.exports = userSchema;