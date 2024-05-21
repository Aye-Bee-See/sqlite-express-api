import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#hooks/all.hooks.mjs';
import Prisoner from '#models/prisoner.model.mjs';
import Rule from '#models/rule.model.mjs';

export default class Prison extends Model {
    static init(sequelize) {
        return super.init(
                Schemas.prison,
                {
                    sequelize,
                    hooks: Hooks.prison || null,
                    modelName: 'Prison'
                }
        );
    }
    static associate(models) {
        this.hasMany(models.Prisoner, { as: 'prisoners', foreignKey: 'prison'});
        this.belongsToMany(models.Rule, { through: 'RulePassthrough', foreignKey: 'ruleId', sourceKey: 'id' });
    }

// Create
    static async createPrison( { prisonName, address })  {
        return await this.create({prisonName, address, deleted: false});
    }

    static async getAllPrisons(full) {
        if (full) {
            return await this.findAll({
                include: [{
                        model: Prisoner,
                        as: "prisoners"
                    },
                    {
                        model: Rule,
                        as: 'rules'
                    }
                ]
            });
        } else {
            return await this.findAll();
        }
    }

// Read
    static async getPrisonByID(id, full) {
        if (full) {
            return await this.findOne({
                include: [{
                        model: Prisoner,
                        as: 'prisoners'
                    },
                    {
                        model: Rule,
                        as: 'rules'
                    }
                ],
                where: {id: id},
            });
        } else {
            return await this.findOne({
                where: {id: id}
            });
        }
    }

// Update
    static async updatePrison(prison) {
        return await this.update({...prison}, {where: {id: prison.id}});
    }

    static async addRule(rule, prison) {
        Rule.findOne({
            where: {id: rule}
        }).then(rule => {
            this.findOne({
                where: {id: prison}
            }).then(prison => {
                rule.addPrison(prison)
            });
        });
    }

// Delete

    static async deletePrison(id) {
        this.update({deleted: true}, {where: {id: id}})
    }
}