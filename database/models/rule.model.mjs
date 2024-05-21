import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#hooks/all.hooks.mjs';
import Prison from '#models/prison.model.mjs';
import Prisoner from '#models/prisoner.model.mjs';

export default class Rule extends Model {
    static init(sequelize) {
        return super.init(
                Schemas.rule,
                {
                    sequelize,
                    hooks: Hooks.rule || null,
                    modelName: 'Rule'
                }
        );
    }
    static async createRule( { prison, title, description })  {
        return await this.create({prison, title, description})
    }

    static async getAllRules(full) {
        if (full) {
            return await this.findAll({
                include: [
                    {
                        model: Prison,
                        as: 'prisons'
                    }
                ]
            })
        } else {
            return await this.findAll({})
        }
    }

    static async getRulesByPrison(prison) {
        return await this.findAll({
            include: [
                {
                    model: Prison,
                    as: 'prisons',
                    where: {
                        id: prison
                    }
                },
            ]
        });
    }

    static async getRuleByID(id, full) {
        if (full) {
            return await this.findOne({
                where: {id: id},
                include: [
                    {
                        model: Prison,
                        as: 'prisons'
                    }
                ]
            })
        } else {
            return await Prisoner.findOne({
                where: {id: id},
            })
        }
    }

    static async updateRule(newRule) {
        return await this.update({...newRule}, {where: {id: newthis.id}});
    }

    static async deleteRule(id) {
        return await this.destroy({where: {id: id}, force: true});
    }
}

