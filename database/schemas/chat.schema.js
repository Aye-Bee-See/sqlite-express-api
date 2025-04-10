import {DataTypes} from 'sequelize';

const chatSchema = {
    user: {
        type: DataTypes.INTEGER,
        model: 'User',

    },
    prisoner: {
        type: DataTypes.INTEGER,
        model: 'Prisoner',
    },
    // Add the id field to the schema
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    }
};

export default chatSchema;
