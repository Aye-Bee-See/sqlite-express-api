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
        this.belongsTo(models.Prison, { as: 'prison_details', foreignKey: 'prisonId'});
        this.hasMany(models.Chat, { as: 'chats', foreignKey: 'prisonerId' });

    }

    // Create

    static async createPrisoner( { birthName, chosenName, prison, inmateID, releaseDate, bio, status })  {
        return await this.create({birthName, chosenName, prison, inmateID, releaseDate, bio, status});
    }
    /**
     *  create multiple prisoners
     *  
     *  @param {array} prisonerArray  - Array of prisoner params
     */
    static async createBulkPrisoners(prisonerArray) {
        return await this.bulkCreate(prisonerArray, {individualHooks: true, ignoreDuplicates: true});
    }

    /**
     * Get raw prisoner count
     * @returns {int} 
     */
    static async countPrisoners() {
        const {count} = await this.findAndCountAll();

        return count;
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

    static async updatePrisoner (prisoner) {
        return await this.update({...prisoner}, {where: {id: prisoner.id}});
    }

// Delete

    static async deletePrisoner(id) {
        return await this.destroy({
            where: {id: id}
        });
    }
}
