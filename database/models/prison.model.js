import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import pick, { updateById } from '#db/pick.js';
import Hooks from '#hooks/all.hooks.js';
import Prisoner from '#models/prisoner.model.js';
import Chapter from '#models/chapter.model.js';
import MailRule, { oneRuleChangeAtATime } from '#models/mail-rule.model.js';
import { inTransaction } from '#services/serial.js';
import { NotFoundError } from '#services/HttpError.js';
import ValidationError from '#services/ValidationError.js';
import { publishedWhere } from '#db/record-status.js';

const PHOTO_RULES_CLASH =
	'photoLimit cannot be set on a facility tagged no_photos; send photoLimit: null or drop the tag.';

/** Fields a client may set on create. */
export const PRISON_FIELDS = [
	'prisonName',
	'address',
	'country',
	'routing',
	'scanService',
	'mailRules',
	'pageLimit',
	'photoLimit',
	'mailLanguages',
	'notes',
	'verifiedBy',
	'verifiedAt',
	'verificationNotes',
	'recordStatus'
];

/** Columns hidden from anonymous and user-role callers. */
export const PRISON_STAFF_ONLY = ['verificationNotes'];

export default class Prison extends Model {
	static init(sequelize) {
		return super.init(Schemas.prison, {
			sequelize,
			hooks: {
				...(Hooks.prison || {}),
				// Rules come back in master-list order, like `mailRules`. (Sequelize runs
				// no hooks for a facility embedded in another record; there only
				// `mailRules` is ordered.)
				afterFind(found) {
					for (const prison of [found].flat()) {
						const details = prison && prison.mail_rule_details;
						if (Array.isArray(details)) {
							details.sort(MailRule.inListOrder);
						}
					}
				}
			},
			modelName: 'Prison',
			validate: {
				// Runs wherever a facility is validated: create, a proposed new facility,
				// and a proposed edit (where the half that is not proposed is the stored one).
				// Sequelize skips a field's validators when the value is null, so say it here:
				// omit mailRules to leave the rules alone, send [] for none.
				mailRulesNotNull() {
					if (this.getDataValue('mailRules') === null) {
						throw new Error('mailRules cannot be null; send [] for a facility with no rules.');
					}
				},
				async photoRules() {
					const mailRules =
						this.mailRules ?? (this.id ? await Prison.ruleTagsOf(this.id) : undefined);
					if (Prison.photoRulesClash({ mailRules, photoLimit: this.photoLimit })) {
						throw new Error(PHOTO_RULES_CLASH);
					}
				}
			}
		});
	}
	static associate(models) {
		this.hasMany(models.Prisoner, {
			as: 'prisoners',
			foreignKey: 'prison',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.belongsToMany(models.Chapter, {
			as: 'relay_groups',
			through: 'PrisonRelay',
			foreignKey: 'prison',
			otherKey: 'chapter'
		});
		this.belongsToMany(models.MailRule, {
			as: 'mail_rule_details',
			through: 'PrisonMailRules',
			foreignKey: 'prison',
			otherKey: 'rule'
		});
		this.belongsTo(models.Chapter, {
			as: 'verified_by_group',
			foreignKey: 'verifiedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** Attribute selection for non-staff readers. */
	static publicAttributes(publishedOnly) {
		return publishedOnly ? { attributes: { exclude: PRISON_STAFF_ONLY } } : {};
	}

	/**
	 * Includes for full=true: prisoners and relay groups, limited to
	 * published ones for non-staff.
	 */
	static #includes(publishedOnly, full = true) {
		if (!full) {
			return [MailRule.detailsInclude()];
		}
		const publishedOnlyOpts = publishedOnly ? { where: publishedWhere(true), required: false } : {};
		return [
			MailRule.detailsInclude(),
			{
				model: Prisoner,
				as: 'prisoners',
				...Prisoner.publicAttributes(publishedOnly),
				...publishedOnlyOpts
			},
			{
				model: Chapter,
				as: 'relay_groups',
				through: { attributes: [] },
				...publishedOnlyOpts
			}
		];
	}

	// Create
	static async createPrison(fields) {
		const clean = pick(fields, PRISON_FIELDS);
		// In the master list's queue, so no rule can be deleted between resolving
		// it and linking to it; and the row and its links are one transaction, so
		// a failure leaves no facility without the rules it was sent with.
		const id = await oneRuleChangeAtATime(async () => {
			// Validation (which resolves the tags) happens before the transaction opens.
			await this.build(clean).validate();
			const rules = await MailRule.resolve(clean.mailRules ?? []);
			return await inTransaction(this.sequelize, async (transaction) => {
				const created = await this.create(clean, { transaction, validate: false });
				if (rules.length > 0) {
					await created.setMail_rule_details(rules, { transaction });
				}
				return created.id;
			});
		});
		return await this.findByPk(id, { include: this.#includes(false, false) });
	}

	/** Ids of the rules a facility carries now. */
	static async ruleIdsOf(prisonId) {
		const [rows] = await this.sequelize.query(
			'SELECT `rule` FROM `PrisonMailRules` WHERE `prison` = :prisonId',
			{ replacements: { prisonId } }
		);
		return rows.map((row) => row.rule);
	}

	/** Codes of the rules a facility carries now. */
	static async ruleTagsOf(prisonId) {
		const [rows] = await this.sequelize.query(
			'SELECT r.`tag` AS tag FROM `PrisonMailRules` p JOIN `MailRules` r ON r.`id` = p.`rule` WHERE p.`prison` = :prisonId',
			{ replacements: { prisonId } }
		);
		return rows.map((row) => row.tag);
	}

	/**
	 * A facility that takes no photos has no photo limit to state. The two
	 * live in different columns, so the columns' own validators cannot see it.
	 */
	static photoRulesClash({ mailRules, photoLimit }) {
		return Array.isArray(mailRules) && mailRules.includes('no_photos') && photoLimit != null;
	}

	/**
	 *  create multiple prisons
	 *
	 *  @param {array} prisonArray  - Array of prison params
	 */
	static async createBulkPrisons(prisonArray) {
		const created = [];
		for (const fields of prisonArray) {
			created.push(await this.createPrison(fields));
		}
		return created;
	}

	/**
	 * Get raw prison count
	 * @returns {int}
	 */
	static async countPrisons() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	// Read

	/**
	 * One page of prisons.
	 * @param {{full?: boolean, limit?: number, offset?: number, publishedOnly?: boolean, where?: object, order?: Array}} options
	 * @returns {Promise<{rows: Prison[], count: number}>}
	 */
	static async getAllPrisons({
		full = false,
		limit,
		offset = 0,
		publishedOnly = false,
		where = {},
		order = [['id', 'ASC']]
	} = {}) {
		return await this.findAndCountAll({
			...this.publicAttributes(publishedOnly),
			where: { ...where, ...publishedWhere(publishedOnly) },
			include: this.#includes(publishedOnly, full),
			limit,
			offset,
			distinct: true,
			order
		});
	}

	/**
	 * @param {number|string} id
	 * @param {{full?: boolean, publishedOnly?: boolean}} options
	 * @returns {Promise<Prison|null>} null when missing, or unpublished and publishedOnly
	 */
	static async getPrisonByID(id, { full = false, publishedOnly = false } = {}) {
		return await this.findOne({
			...this.publicAttributes(publishedOnly),
			where: { id, ...publishedWhere(publishedOnly) },
			include: this.#includes(publishedOnly, full)
		});
	}

	// Update
	static async updatePrison(prison) {
		const { mailRules, ...columns } = pick(prison, PRISON_FIELDS);
		if (mailRules === undefined && columns.photoLimit === undefined) {
			return await updateById(this, prison.id, columns);
		}
		// Checked against each other, then written to two tables: one queue (shared
		// with master-list changes) and one transaction, so two partial updates cannot
		// each pass and clash together, and nothing is left half written.
		return await oneRuleChangeAtATime(async () => {
			const stored = await this.findByPk(prison.id, { attributes: ['id', 'photoLimit'] });
			if (!stored) {
				return [0];
			}
			const rules =
				mailRules === undefined
					? null
					: await MailRule.resolve(mailRules, await this.ruleIdsOf(stored.id));
			// Whichever half was not sent is the stored one.
			const clash = Prison.photoRulesClash({
				mailRules: rules ? rules.map((rule) => rule.tag) : await this.ruleTagsOf(stored.id),
				photoLimit: columns.photoLimit !== undefined ? columns.photoLimit : stored.photoLimit
			});
			if (clash) {
				throw new ValidationError(PHOTO_RULES_CLASH);
			}
			await inTransaction(this.sequelize, async (transaction) => {
				if (Object.keys(columns).length > 0) {
					// The model's own photo check runs here too; give it the rules as they
					// will be, not as they are stored (mailRules is virtual: no column is written).
					const values = rules ? { ...columns, mailRules: rules.map((rule) => rule.tag) } : columns;
					await this.update(values, { where: { id: stored.id }, transaction });
				}
				if (rules) {
					await stored.setMail_rule_details(rules, { transaction });
				}
			});
			return [1];
		});
	}

	/**
	 * Load a prison and a related record for a link operation.
	 * @throws {NotFoundError} when either is missing
	 */
	static async #pair(prisonId, Related, relatedId, label) {
		const [prison, related] = await Promise.all([
			this.findByPk(prisonId),
			Related.findByPk(relatedId)
		]);
		if (!related) {
			throw new NotFoundError(label + ' ' + relatedId + ' not found');
		}
		if (!prison) {
			throw new NotFoundError('Prison ' + prisonId + ' not found');
		}
		return [prison, related];
	}

	/**
	 * Attach a relay group (chapter) to a prison (idempotent).
	 * @returns {Promise<Prison>} the prison with its relations loaded
	 */
	static async addRelay(chapterId, prisonId) {
		const [prison, chapter] = await this.#pair(prisonId, Chapter, chapterId, 'Chapter');
		await prison.addRelay_group(chapter);
		return await this.getPrisonByID(prisonId, { full: true });
	}

	/**
	 * Detach a relay group from a prison.
	 * @returns {Promise<number>} links removed (0 when there was none)
	 */
	static async removeRelay(chapterId, prisonId) {
		const [prison, chapter] = await this.#pair(prisonId, Chapter, chapterId, 'Chapter');
		return await prison.removeRelay_group(chapter);
	}

	// Delete

	static async deletePrison(id) {
		return await this.destroy({ where: { id: id } });
	}
}
