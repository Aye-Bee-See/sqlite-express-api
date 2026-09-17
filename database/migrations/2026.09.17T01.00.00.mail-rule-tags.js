import { DataTypes } from 'sequelize';

/**
 * Mail rules become tags on the facility: Prisons.mailRules (a JSON array
 * of tags from database/mail-rules.js) with three typed limits beside it
 * (pageLimit, photoLimit, mailLanguages). The free-text Rules records and
 * their attachments (RulePassthrough) are converted and dropped.
 *
 * The title table below is a snapshot, on purpose: a migration must keep
 * doing what it did when it shipped, whatever the vocabulary becomes.
 */

const LEGACY_RULE_TITLES = {
	'No pictures': { tag: 'no_photos' },
	'No contraband': { tag: 'no_enclosures' },
	'Plain envelopes only': { tag: 'plain_envelopes' },
	'Return address required': { tag: 'return_address_required' },
	'Full name and number': { tag: 'full_name_and_number' },
	'Blue or black ink only': { tag: 'ink_blue_or_black' },
	'Plain paper only': { tag: 'plain_paper' },
	'No polaroids': { tag: 'no_polaroids' },
	'Photos: maximum 5': { photoLimit: 5 },
	'No nude or suggestive photos': { tag: 'no_explicit_photos' },
	'No gang signs in photos': { tag: 'no_gang_imagery' },
	'Page limit: 10': { pageLimit: 10 },
	'Page limit: 5': { pageLimit: 5 },
	'Postcards only': { tag: 'postcards_only' },
	'No greeting cards': { tag: 'no_greeting_cards' },
	'No stickers or labels': { tag: 'no_stickers_or_labels' },
	'No perfume or lipstick': { tag: 'no_scents_or_lipstick' },
	'No glue or tape inside': { tag: 'no_glue_tape_or_staples' },
	'No newspaper clippings': { tag: 'no_clippings' },
	'Printed internet pages allowed': { tag: 'printed_pages_allowed' },
	'Books from publishers only': { tag: 'books_from_publisher_only' },
	'Paperbacks only': { tag: 'paperbacks_only' },
	'No maps': { tag: 'no_maps' },
	'No coded messages': { tag: 'no_coded_messages' },
	'English only': { mailLanguages: ['en'] },
	'Spanish or English': { mailLanguages: ['en', 'es'] },
	'Russian only': { mailLanguages: ['ru'] },
	'Scanned, not delivered': { tag: 'originals_destroyed' },
	'Scanned mail: no colour': { tag: 'scanned_in_greyscale' },
	'Digital mail only': { tag: 'digital_mail_only' },
	'Mail opened and read': { tag: 'mail_read_by_staff' },
	'Legal mail marked clearly': { tag: 'legal_mail_marked' },
	'No third-party mail': { tag: 'no_third_party_mail' },
	'No mail between prisoners': { tag: 'no_inter_prisoner_mail' },
	'No unknown senders': { tag: 'approved_senders_only' },
	'Sender approval form': { tag: 'sender_approval_form' },
	'One letter per envelope': { tag: 'one_letter_per_envelope' },
	'No money orders': { tag: 'no_money' },
	'Stamps not accepted': { tag: 'no_stamps_enclosed' },
	'No drawings by others': { tag: 'no_drawings_by_others' },
	'Typed letters allowed': { tag: 'typed_letters_allowed' },
	'Registered post recommended': { tag: 'registered_post_recommended' },
	'Delivery not confirmed': { tag: 'delivery_not_confirmed' },
	'Holiday mail limits': { tag: 'holiday_card_limit' }
};

/** The stricter of two limits; languages accumulate. */
function merge(into, mapped) {
	if (mapped.tag && !into.tags.includes(mapped.tag)) {
		into.tags.push(mapped.tag);
	}
	for (const field of ['pageLimit', 'photoLimit']) {
		if (mapped[field] !== undefined) {
			into[field] = into[field] === null ? mapped[field] : Math.min(into[field], mapped[field]);
		}
	}
	if (mapped.mailLanguages) {
		into.mailLanguages = [...new Set([...(into.mailLanguages || []), ...mapped.mailLanguages])];
	}
}

export async function up({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	await queryInterface.addColumn('Prisons', 'mailRules', {
		type: DataTypes.JSON,
		allowNull: false,
		defaultValue: []
	});
	await queryInterface.addColumn('Prisons', 'pageLimit', { type: DataTypes.INTEGER });
	await queryInterface.addColumn('Prisons', 'photoLimit', { type: DataTypes.INTEGER });
	await queryInterface.addColumn('Prisons', 'mailLanguages', { type: DataTypes.JSON });

	const [attached] = await sequelize.query(
		'SELECT p.`prison` AS prison, r.`title` AS title, r.`description` AS description FROM `RulePassthrough` p JOIN `Rules` r ON r.`id` = p.`rule` ORDER BY p.`prison`, r.`id`'
	);
	const byPrison = new Map();
	for (const row of attached) {
		if (!byPrison.has(row.prison)) {
			byPrison.set(row.prison, {
				tags: [],
				pageLimit: null,
				photoLimit: null,
				mailLanguages: null,
				unconverted: []
			});
		}
		const entry = byPrison.get(row.prison);
		const mapped = LEGACY_RULE_TITLES[(row.title || '').trim()];
		if (mapped) {
			merge(entry, mapped);
		} else {
			// A rule someone wrote by hand has no tag. Keep its words in the notes.
			entry.unconverted.push([row.title, row.description].filter(Boolean).join(': '));
		}
	}
	for (const [prison, entry] of byPrison) {
		// A facility that takes no photos has no photo limit to state.
		const photoLimit = entry.tags.includes('no_photos') ? null : entry.photoLimit;
		await sequelize.query(
			'UPDATE `Prisons` SET `mailRules` = :mailRules, `pageLimit` = :pageLimit, `photoLimit` = :photoLimit, `mailLanguages` = :mailLanguages WHERE `id` = :prison',
			{
				replacements: {
					prison,
					mailRules: JSON.stringify(entry.tags),
					pageLimit: entry.pageLimit,
					photoLimit,
					mailLanguages: entry.mailLanguages ? JSON.stringify(entry.mailLanguages) : null
				}
			}
		);
		if (entry.unconverted.length > 0) {
			const addition = entry.unconverted.map(
				(text) => 'Mail rule (not converted to a tag): ' + text
			);
			await sequelize.query(
				"UPDATE `Prisons` SET `notes` = TRIM(COALESCE(`notes`, '') || :addition, char(10)) WHERE `id` = :prison",
				{ replacements: { prison, addition: '\n' + addition.join('\n') } }
			);
		}
	}

	await queryInterface.dropTable('RulePassthrough');
	await queryInterface.dropTable('Rules');
}

/**
 * Down restores the two tables, one rule record per tag or limit in use,
 * attached to the facilities that had it. Wording comes from the snapshot.
 */
export async function down({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	const { withForeignKeysOff } = await import('../migration-helpers.js');
	const timestamps = {
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	};
	await queryInterface.createTable('Rules', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		title: { type: DataTypes.STRING },
		description: { type: DataTypes.STRING },
		...timestamps
	});
	await queryInterface.createTable('RulePassthrough', {
		...timestamps,
		prison: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			references: { model: 'Prisons', key: 'id' },
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		},
		rule: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			references: { model: 'Rules', key: 'id' },
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		}
	});

	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	const titleFor = (wanted) =>
		Object.keys(LEGACY_RULE_TITLES).find((title) => same(LEGACY_RULE_TITLES[title], wanted));
	const [prisons] = await sequelize.query(
		'SELECT `id`, `mailRules`, `pageLimit`, `photoLimit`, `mailLanguages` FROM `Prisons`'
	);
	const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
	const ruleIds = new Map();
	const now = new Date();
	for (const prison of prisons) {
		const wanted = (parse(prison.mailRules) || []).map((tag) => ({ tag }));
		if (prison.pageLimit !== null) {
			wanted.push({ pageLimit: prison.pageLimit });
		}
		if (prison.photoLimit !== null) {
			wanted.push({ photoLimit: prison.photoLimit });
		}
		const languages = parse(prison.mailLanguages);
		if (languages && languages.length > 0) {
			wanted.push({ mailLanguages: [...languages].sort() });
		}
		for (const item of wanted) {
			const title = titleFor(item) || Object.values(item)[0].toString();
			if (!ruleIds.has(title)) {
				await queryInterface.bulkInsert('Rules', [
					{ title, description: null, createdAt: now, updatedAt: now }
				]);
				const [[created]] = await sequelize.query(
					'SELECT `id` FROM `Rules` WHERE `title` = :title ORDER BY `id` DESC LIMIT 1',
					{ replacements: { title } }
				);
				ruleIds.set(title, created.id);
			}
			await queryInterface.bulkInsert('RulePassthrough', [
				{ prison: prison.id, rule: ruleIds.get(title), createdAt: now, updatedAt: now }
			]);
		}
	}

	await withForeignKeysOff(queryInterface, async () => {
		for (const column of ['mailLanguages', 'photoLimit', 'pageLimit', 'mailRules']) {
			await queryInterface.removeColumn('Prisons', column);
		}
	});
}
