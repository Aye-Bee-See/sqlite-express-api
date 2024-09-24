import {DataTypes} from 'sequelize';

const chatSchema = {
    user: {
        type: DataTypes.INTEGER,
        model: 'User',

    },
    prisoner: {
        type: DataTypes.INTEGER,
        model: 'Prisoner',
    }
};

export default chatSchema;
