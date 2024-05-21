import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#hooks/all.hooks.mjs';
import Chat from '#models/chat.model.mjs';
import Prison from '#models/prison.model.mjs';


export default class Prisoner extends Model {
    static init(sequelize) {
        return super.init(
                Schemas.prisoner,
                {
                    sequelize,
                    hooks: Hooks.prisoner || null,
                    modelName: 'Prisoner'
                }
        );
    }
    static associate(models) {
        this.belongsTo(models.Prison, {as: 'prisons', foreignKey: 'prison_id', sourceKey: 'prison'});
        this.hasMany(models.Chat, {as: 'chats', foreignKey: 'prisoner_key'});
    }

    // Create

    static async createPrisoner( { birthName, chosenName, prison, inmateID, releaseDate, bio })  {
        return await this.create({birthName, chosenName, prison, inmateID, releaseDate, bio});
    }

// Read

    static async getAllPrisoners(full) {
        if (full) {
            return await this.findAll({
                include: [
                    {
                        model: Prison,
                        as: 'prison_details',
                        key: 'prison_key'
                    }
                ]
            })
        } else {
            return await this.findAll();
        }
    }

    static async getPrisonerByID(id, full) {
        if (full) {
            return await this.findOne({
                include: [
                    {
                        model: Prison,
                        as: 'prison_details'
                    }
                ],
                where: {id: id},
            });
        } else {
            return await this.findOne({
                where: {id: id},
            });
        }
    }

    static async getPrisonersByPrison(prisonId, full) {
        if (full) {
            return await this.findAll({
                include: [
                    {
                        model: Chat,
                        as: "chats"
                    }
                ],
                where: {prison: prisonId}
            })
        } else {
            return await this.findAll({
                where: {prison: prisonId}
            })
        }
    }

// Update

    static async updatePrisoner (newPrisoner) {
        return await this.update({...newPrisoner}, {where: {id: newthis.id}});
    }

// Delete

    static async deletePrisoner(id) {
        return await this.destroy({
            where: {id: id}
        });
    }
}
