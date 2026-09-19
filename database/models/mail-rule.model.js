import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { MAIL_RULE_CATEGORIES, MAIL_RULE_CONFLICTS } from '#db/mail-rules.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';

/** What a client sees of a rule, on the master list and embedded in a facility. */
const PUBLIC_ATTRIBUTES = ['id', 'tag', 'category', 'label', 'description', 'retiredAt'];

/**
 * The words of a tag or label, order and plurals aside, so that
 * `english_only`, `only_english`, and "Only English" all compare equal.
 */
function fingerprint(text) {
	return String(text)
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
		.sort()
		.join(' ');
}

/** Master-list order: by category as facility pages show them, then by age. */
function inListOrder(a, b) {
	return (
		MAIL_RULE_CATEGORIES.indexOf(a.category) - MAIL_RULE_CATEGORIES.indexOf(b.category) ||
		a.id - b.id
	);
}

/**
 * The master list of mail rules. A facility has one or more of these; it
 * never has rule text of its own. Admins extend the list; `tag` is unique
 * and never changes, because clients key translations and icons on it.
 */
export default class MailRule extends Model {
	static init(sequelize) {
		return super.init(Schemas.mailRule, {
			sequelize,
			modelName: 'MailRule',
			tableName: 'MailRules'
		});
	}

	static associate(models) {
		this.belongsToMany(models.Prison, {
			as: 'prisons',
			through: 'PrisonMailRules',
			foreignKey: 'rule',
			otherKey: 'prison'
		});
		this.belongsTo(models.User, {
			as: 'creator',
			foreignKey: 'createdBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	static inListOrder = inListOrder;

	/** The include that puts `mail_rule_details` (and so `mailRules`) on a facility, wherever one is read. */
	static detailsInclude() {
		return {
			model: MailRule,
			as: 'mail_rule_details',
			attributes: PUBLIC_ATTRIBUTES,
			through: { attributes: [] }
		};
	}

	/** @param {{includeRetired?: boolean}} options */
	static async list({ includeRetired = false } = {}) {
		const rows = await this.findAll({
			attributes: PUBLIC_ATTRIBUTES,
			where: includeRetired ? {} : { retiredAt: null }
		});
		return rows.sort(inListOrder);
	}

	/**
	 * An existing rule that says the same thing in other words, if any.
	 * @returns {Promise<MailRule|null>}
	 */
	static async lookalike({ tag, label }, exceptId = null) {
		const wanted = new Set([tag, label].filter(Boolean).map(fingerprint));
		const rows = await this.findAll({ attributes: ['id', 'tag', 'label'] });
		return (
			rows.find(
				(row) =>
					row.id !== exceptId &&
					(wanted.has(fingerprint(row.tag)) || wanted.has(fingerprint(row.label)))
			) || null
		);
	}

	/**
	 * Add a rule to the master list.
	 * @throws {ValidationError} bad fields; {HttpError} 409 when the list already says it
	 */
	static async createRule({ tag, category, label, description }, createdBy = null) {
		const candidate = this.build({ tag, category, label, description, createdBy });
		await candidate.validate();
		const existing = await this.lookalike({ tag, label });
		if (existing) {
			throw new HttpError(
				409,
				'The master list already has this rule as "' +
					existing.tag +
					'" (' +
					existing.label +
					'). Use that one, or reword it.',
				'DuplicateRuleError'
			);
		}
		return await candidate.save();
	}

	/**
	 * Reword, recategorise, retire, or restore a rule. Its tag never changes.
	 * @param {number} id
	 * @param {{category?: string, label?: string, description?: string, retired?: boolean}} changes
	 * @returns {Promise<MailRule|null>} null when there is no such rule
	 */
	static async updateRule(id, { tag, category, label, description, retired }) {
		const rule = await this.findByPk(id);
		if (!rule) {
			return null;
		}
		if (tag !== undefined && tag !== rule.tag) {
			throw new HttpError(
				409,
				'A rule tag never changes: clients key translations and icons on it. Retire this rule and add a new one.',
				'RuleTagError'
			);
		}
		if (label !== undefined && label !== rule.label) {
			const existing = await this.lookalike({ label }, rule.id);
			if (existing) {
				throw new HttpError(
					409,
					'That wording belongs to "' + existing.tag + '" (' + existing.label + ').',
					'DuplicateRuleError'
				);
			}
		}
		if (retired !== undefined && typeof retired !== 'boolean') {
			throw new ValidationError('retired must be true or false.');
		}
		rule.set({
			...(category !== undefined ? { category } : {}),
			...(label !== undefined ? { label } : {}),
			...(description !== undefined ? { description } : {}),
			...(retired !== undefined
				? { retiredAt: retired ? (rule.retiredAt ?? new Date()) : null }
				: {})
		});
		return await rule.save();
	}

	/** How many facilities carry this rule. */
	static async usage(id) {
		const [[{ n }]] = await this.sequelize.query(
			'SELECT COUNT(*) AS n FROM `PrisonMailRules` WHERE `rule` = :id',
			{ replacements: { id } }
		);
		return Number(n);
	}

	/**
	 * Resolve the tags a facility is to carry into rules.
	 * @param {unknown} tags from a request
	 * @param {number[]} [alreadyHeld] rule ids the facility has now; a retired rule may stay, not arrive
	 * @returns {Promise<MailRule[]>}
	 * @throws {ValidationError}
	 */
	static async resolve(tags, alreadyHeld = []) {
		if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
			throw new ValidationError(
				'mailRules must be an array of rule tags from the master list (GET /prison/mail-rules).'
			);
		}
		if (new Set(tags).size !== tags.length) {
			throw new ValidationError('mailRules lists a rule more than once.');
		}
		const rules = tags.length === 0 ? [] : await this.findAll({ where: { tag: tags } });
		const known = new Set(rules.map((rule) => rule.tag));
		const unknown = tags.filter((tag) => !known.has(tag));
		if (unknown.length > 0) {
			throw new ValidationError(
				'Not on the master list of mail rules: ' +
					unknown.map((tag) => JSON.stringify(tag)).join(', ') +
					'. GET /prison/mail-rules lists them; an admin can add one.'
			);
		}
		const retired = rules.filter((rule) => rule.retiredAt && !alreadyHeld.includes(rule.id));
		if (retired.length > 0) {
			throw new ValidationError(
				'Retired rules cannot be added to a facility: ' +
					retired.map((rule) => rule.tag).join(', ') +
					'.'
			);
		}
		for (const [a, b] of MAIL_RULE_CONFLICTS) {
			if (known.has(a) && known.has(b)) {
				throw new ValidationError('mailRules cannot hold both ' + a + ' and ' + b + '.');
			}
		}
		return rules;
	}
}
