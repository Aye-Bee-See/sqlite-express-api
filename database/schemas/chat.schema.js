import {DataTypes} from 'sequelize';

const chatSchema = {
    user: {
        type: DataTypes.INTEGER,
        model: 'User',
        allowNull: false,

    },
    prisoner: {
        type: DataTypes.INTEGER,
        model: 'Prisoner',
        allowNull: false,
    },
    // Add the id field to the schema
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    }
};

export default chatSchema;
