import {Sequelize, Model} from 'sequelize';
import * as Models from "#models/all.model.mjs";

import {createSeeds} from './seeds/all.seeds.mjs';

const config = {
    database: 'users_db',
    username: 'root',
    password: '',
    dialect: 'sqlite',
    storage: 'database.sqlite'
};

export const sequelize = new Sequelize(config);

export const Chat = Models.Chat.init(sequelize, Sequelize);
export const Message = Models.Message.init(sequelize, Sequelize);
export const Prison = Models.Prison.init(sequelize, Sequelize);
export const Prisoner = Models.Prisoner.init(sequelize, Sequelize);
export const Rule = Models.Rule.init(sequelize, Sequelize);
export const User = Models.User.init(sequelize, Sequelize);
export const Chapter = Models.Chapter.init(sequelize, Sequelize);

Prisoner.associate(Models);
Prison.associate(Models);
Message.associate(Models);
User.associate(Models);
Chat.associate(Models);
Rule.associate(Models);
Chapter.associate(Models);

sequelize.sync({force: true}).then(async() => {
    return await createSeeds();
});