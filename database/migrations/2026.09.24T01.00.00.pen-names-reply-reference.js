import { DataTypes } from 'sequelize';
import { dropColumn, withForeignKeysOff } from '../migration-helpers.js';
import { newReference } from '../reply-reference.js';

/**
 * Pen names and the reply reference (decided 22 September 2026).
 *
 * A pen name is the site-unique name a letter is signed with; old names are
 * kept for ever (PenNames) and never given to anyone else. A reply reference
 * is a nine-digit number on every outgoing letter; a small row of ids
 * (ReplyReferences) outlives the letter for a while so a late reply still
 * finds its writer. Two mail rules join the master list: a facility whose mail
 * room rejects reference numbers, and one that allows a reply sheet.
 */
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const KEEP_MONTHS = 12;

const RULES = [
	{
		tag: 'no_reference_numbers',
		category: 'addressing',
		label: 'No reference numbers',
		description:
			'The mail room refuses letters carrying an unexplained number or code. Letters to this facility carry the writer’s name and the group’s address only, no reply reference.'
	},
	{
		tag: 'reply_sheet_allowed',
		category: 'enclosures',
		label: 'Reply sheet allowed',
		description:
			'A blank reply sheet carrying the return address and the reply reference may be enclosed with a letter. Off elsewhere, since many facilities refuse blank paper.'
	}
];

export async function up({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	await queryInterface.addColumn('User', 'penName', { type: DataTypes.STRING });
	await queryInterface.createTable('PenNames', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		userId: {
			type: DataTypes.INTEGER,
			allowNull: false,
			references: { model: 'User', key: 'id' },
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		},
		name: { type: DataTypes.STRING, allowNull: false },
		/** The name folded for uniqueness: NFKC, lower case, one space between words. */
		nameKey: { type: DataTypes.STRING, allowNull: false, unique: true },
		retiredAt: { type: DataTypes.DATE },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('PenNames', ['userId'], { name: 'pen_names_user' });

	await queryInterface.addColumn('Messages', 'replyReference', { type: DataTypes.STRING });
	await queryInterface.addColumn('Messages', 'repliesTo', {
		type: DataTypes.INTEGER,
		references: { model: 'Messages', key: 'id' },
		onDelete: 'SET NULL',
		onUpdate: 'CASCADE'
	});
	await queryInterface.addIndex('Messages', ['replyReference'], {
		name: 'messages_reply_reference',
		unique: true
	});
	await queryInterface.createTable('ReplyReferences', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		reference: { type: DataTypes.STRING, allowNull: false, unique: true },
		message: {
			type: DataTypes.INTEGER,
			references: { model: 'Messages', key: 'id' },
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		},
		user: {
			type: DataTypes.INTEGER,
			allowNull: false,
			references: { model: 'User', key: 'id' },
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		},
		prisoner: {
			type: DataTypes.INTEGER,
			allowNull: false,
			references: { model: 'Prisoners', key: 'id' },
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		},
		chapter: {
			type: DataTypes.INTEGER,
			references: { model: 'Chapters', key: 'id' },
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		},
		mailedAt: { type: DataTypes.DATE },
		/** Set when mailed; the row is removed after this once its letter is gone. */
		expiresAt: { type: DataTypes.DATE },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('ReplyReferences', ['chapter', 'user'], {
		name: 'reply_references_chapter_user'
	});
	await queryInterface.addIndex('ReplyReferences', ['message'], {
		name: 'reply_references_message'
	});

	// Every outgoing letter that exists gets a reference now, so a reply to a
	// letter mailed before this can still be filed by number.
	const [letters] = await sequelize.query(
		"SELECT id, user, prisoner, relayChapter, status, statusChangedAt, createdAt FROM Messages WHERE sender = 'user' AND replyReference IS NULL"
	);
	const now = new Date();
	const stamp = now.toISOString().replace('T', ' ').replace('Z', ' +00:00');
	for (const letter of letters) {
		let reference;
		for (;;) {
			reference = newReference();
			const [taken] = await sequelize.query(
				'SELECT 1 FROM ReplyReferences WHERE reference = :reference',
				{ replacements: { reference } }
			);
			if (taken.length === 0) {
				break;
			}
		}
		const mailed = ['mailed', 'returned'].includes(letter.status)
			? new Date(letter.statusChangedAt || letter.createdAt)
			: null;
		await sequelize.query('UPDATE Messages SET replyReference = :reference WHERE id = :id', {
			replacements: { reference, id: letter.id }
		});
		await sequelize.query(
			'INSERT INTO ReplyReferences (reference, message, user, prisoner, chapter, mailedAt, expiresAt, createdAt, updatedAt) VALUES (:reference, :message, :user, :prisoner, :chapter, :mailedAt, :expiresAt, :now, :now)',
			{
				replacements: {
					reference,
					message: letter.id,
					user: letter.user,
					prisoner: letter.prisoner,
					chapter: letter.relayChapter ?? null,
					mailedAt: mailed ? mailed.toISOString().replace('T', ' ').replace('Z', ' +00:00') : null,
					expiresAt: mailed
						? new Date(mailed.getTime() + KEEP_MONTHS * MONTH_MS)
								.toISOString()
								.replace('T', ' ')
								.replace('Z', ' +00:00')
						: null,
					now: stamp
				}
			}
		);
	}

	for (const rule of RULES) {
		const [exists] = await sequelize.query('SELECT id FROM MailRules WHERE tag = :tag', {
			replacements: { tag: rule.tag }
		});
		if (exists.length === 0) {
			await queryInterface.bulkInsert('MailRules', [{ ...rule, createdAt: now, updatedAt: now }]);
		}
	}
}

export async function down({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	for (const rule of RULES) {
		const [rows] = await sequelize.query('SELECT id FROM MailRules WHERE tag = :tag', {
			replacements: { tag: rule.tag }
		});
		for (const row of rows) {
			await sequelize.query('DELETE FROM PrisonMailRules WHERE rule = :id', {
				replacements: { id: row.id }
			});
			await sequelize.query('DELETE FROM MailRules WHERE id = :id', {
				replacements: { id: row.id }
			});
		}
	}
	await queryInterface.dropTable('ReplyReferences');
	await queryInterface.removeIndex('Messages', 'messages_reply_reference');
	await dropColumn(queryInterface, 'Messages', 'replyReference');
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('Messages', 'repliesTo');
	});
	await queryInterface.dropTable('PenNames');
	await dropColumn(queryInterface, 'User', 'penName');
}
