import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';

/**
 * Settings a superadmin changes while the site runs, as opposed to the ones in
 * the environment that need a restart. Read on every signed-in request (the
 * two-factor requirement), so kept in memory and read again only after a write.
 */
export default class SiteSetting extends Model {
	static #cache = new Map();

	static init(sequelize) {
		return super.init(Schemas.siteSetting, {
			sequelize,
			modelName: 'SiteSetting',
			tableName: 'SiteSettings'
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'updated_by',
			foreignKey: 'updatedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** A setting's value, or the fallback when it was never set. */
	static async read(key, fallback) {
		if (!SiteSetting.#cache.has(key)) {
			const row = await this.findByPk(key);
			SiteSetting.#cache.set(key, row ? row.value : undefined);
		}
		const value = SiteSetting.#cache.get(key);
		return value === undefined ? fallback : value;
	}

	static async write(key, value, updatedBy = null) {
		await this.upsert({ key, value, updatedBy });
		SiteSetting.#cache.set(key, value);
		return value;
	}

	/** Forget what was read (tests that reset the database). */
	static forget() {
		SiteSetting.#cache.clear();
	}
}
