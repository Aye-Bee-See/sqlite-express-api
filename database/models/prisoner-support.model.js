import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';

/**
 * Link table between prisoners and the support groups (chapters) that back
 * them, with a short description of the group's role ("letter collection,
 * US Pacific Northwest"). Used as the `through` model of the
 * Prisoner <-> Chapter association.
 */
export default class PrisonerSupport extends Model {
	static init(sequelize) {
		return super.init(Schemas.prisonerSupport, {
			sequelize,
			modelName: 'PrisonerSupport',
			tableName: 'PrisonerSupport'
		});
	}

	static associate() {}
}
