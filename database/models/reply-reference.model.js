import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { replyReferenceMonths } from '#constants';
import { newReference, isReference, normalizeReference } from '#db/reply-reference.js';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The ids behind every reply reference: writer, prisoner, and the group that
 * mailed the letter. The letter carries the number for printing; this row is
 * what a late reply is filed by after the letter itself has been deleted, for
 * REPLY_REFERENCE_MONTHS after mailing. It holds no content, and it goes with
 * the writer's account.
 */
export default class ReplyReference extends Model {
	static init(sequelize) {
		return super.init(Schemas.replyReference, {
			sequelize,
			modelName: 'ReplyReference',
			tableName: 'ReplyReferences'
		});
	}

	static associate(models) {
		this.belongsTo(models.Message, {
			as: 'letter',
			foreignKey: 'message',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'writer',
			foreignKey: 'user',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Prisoner, {
			as: 'prisoner_details',
			foreignKey: 'prisoner',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Chapter, {
			as: 'relay_group',
			foreignKey: 'chapter',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/**
	 * A fresh reference for a letter just created. Collisions are one in a
	 * hundred million and retried.
	 * @returns {Promise<string>} the nine digits
	 */
	static async issue(letter, { transaction = null } = {}) {
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const reference = newReference();
			try {
				await this.create(
					{
						reference,
						message: letter.id,
						user: letter.user,
						prisoner: letter.prisoner,
						chapter: letter.relayChapter ?? null
					},
					{ transaction }
				);
				return reference;
			} catch (err) {
				if (!(err && err.name === 'SequelizeUniqueConstraintError')) {
					throw err;
				}
			}
		}
		throw new Error('Could not find a free reply reference.');
	}

	/**
	 * The letters are in the post: the references start their year, under the
	 * group that mailed them (a letter may have been rerouted since it was written).
	 * @param {{id: number, chapter: number|null}[]} letters
	 */
	static async markMailed(letters, { transaction = null, now = new Date() } = {}) {
		const expiresAt = new Date(now.getTime() + replyReferenceMonths * MONTH_MS);
		for (const letter of letters) {
			await this.update(
				{ mailedAt: now, expiresAt, chapter: letter.chapter },
				{ where: { message: letter.id, mailedAt: null }, transaction }
			);
		}
	}

	/**
	 * @returns {Promise<{state: 'invalid'|'unknown'|'found', row: ReplyReference|null}>}
	 */
	static async lookup(number) {
		if (!isReference(number)) {
			return { state: 'invalid', row: null };
		}
		const row = await this.findOne({ where: { reference: normalizeReference(number) } });
		return row ? { state: 'found', row } : { state: 'unknown', row: null };
	}

	/** The writers whose letters a group has mailed (or holds), by the references it issued. */
	static async writerIdsFor(chapterId) {
		const rows = await this.findAll({
			where: { chapter: chapterId },
			attributes: ['user'],
			group: ['user']
		});
		return rows.map((row) => row.user);
	}

	/**
	 * Rows whose letter is gone and whose time is up (or that were never mailed).
	 * @returns {Promise<number>}
	 */
	static async purge(now = new Date()) {
		return await this.destroy({
			where: { message: null, [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.lt]: now } }] }
		});
	}
}
