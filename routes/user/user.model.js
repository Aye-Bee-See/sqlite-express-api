const sequelize = require('sequelize');
const DataTypes = sequelize.DataTypes;

const userSchema = {
  name: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    validate: {
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
        msg: "Email cannot be null"
      }
  },
    unique: {
      args: true,
      msg: 'Email address already in use'
    }
  },
  role: {
    type: DataTypes.STRING,
  }
}

module.exports = userSchema