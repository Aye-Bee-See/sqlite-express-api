import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import Chat from '#models/chat.model.js';
import Prison from '#models/prison.model.js';
import modelsService from '#models/models.service.js';

export default class Prisoner extends Model {
	static init(sequelize) {
		return super.init(Schemas.prisoner, {
			sequelize,
			hooks: Hooks.prisoner || null,
			modelName: 'Prisoner'
		});
	}
	static associate(models) {
		this.belongsTo(models.Prison, { as: 'prison_details', foreignKey: 'prison' });
		this.hasMany(models.Chat, { as: 'chats', foreignKey: 'prisoner' });
	}

	// Create

	static async createPrisoner({
		birthName,
		chosenName,
		prison,
		inmateID,
		releaseDate,
		bio,
		status,
		avatar
	}) {
		return await this.create({
			birthName,
			chosenName,
			prison,
			inmateID,
			releaseDate,
			bio,
			status,
			avatar
		});
	}
	/**
	 *  create multiple prisoners
	 *
	 *  @param {array} prisonerArray  - Array of prisoner params
	 */
	static async createBulkPrisoners(prisonerArray) {
		return await this.bulkCreate(prisonerArray, { individualHooks: true, ignoreDuplicates: true });
	}

	/**
	 * Get raw prisoner count
	 * @returns {int}
	 */
	static async countPrisoners() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	// Read

	static async getAllPrisoners(full, limit, offset = 0) {
		let filters = { limit, offset };
		let options;
		if (full) {
			options = {
				include: [
					{
						model: Prison,
						as: 'prison_details',
						key: 'prison_key'
					}
				]
			};
		}
		filters = { ...filters, ...options };
		return await Prisoner.findAll(filters);
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
				where: { id: id }
			});
		} else {
			return await this.findOne({
				where: { id: id }
			});
		}
	}

	static async getPrisonersByPrison(prisonId, full, limit, offset = 0) {
		const exists = await modelsService.modelInstanceExists('Prison', prisonId);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { prison: prisonId }
		};
		if (full) {
			options = {
				include: [
					{
						model: Chat,
						as: 'chats'
					}
				],
				where: { prison: prisonId }
			};
		}
		filters = { ...filters, ...options };
		return await Prisoner.findAll(filters);
	}

	// Update

	static async updatePrisoner(prisoner) {
		return await this.update({ ...prisoner }, { where: { id: prisoner.id } });
	}

	// Delete

	static async deletePrisoner(id) {
		return await this.destroy({
			where: { id: id }
		});
	}
}
