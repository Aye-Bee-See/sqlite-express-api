import { DataTypes } from 'sequelize';

/**
 * The master list of mail rules moves into the database, where admins can
 * add to it: MailRules (unique, immutable tag; category; wording; retired
 * flag) and PrisonMailRules, which links a facility to its rules with
 * foreign keys. Prisons.mailRules, a JSON array of the same tags checked
 * only by the application, is converted into links and dropped.
 *
 * The list below is a snapshot of the rules as they stood in code; a
 * migration keeps doing what it did when it shipped.
 */

const RULES = [
	{
		tag: 'return_address_required',
		category: 'addressing',
		label: 'Return address required',
		description: 'Every envelope needs a full sender name and postal address or it is refused.'
	},
	{
		tag: 'full_name_and_number',
		category: 'addressing',
		label: 'Full name and number',
		description:
			"Address mail with the prisoner's full legal name and inmate number; nicknames are not delivered."
	},
	{
		tag: 'plain_envelopes',
		category: 'addressing',
		label: 'Plain envelopes only',
		description: 'White or manila envelopes with no stickers, tape, drawings, or coloured ink.'
	},
	{
		tag: 'no_stickers_or_labels',
		category: 'addressing',
		label: 'No stickers or labels',
		description:
			'Address labels, stickers, and stamps other than postage are not allowed on the envelope.'
	},
	{
		tag: 'one_letter_per_envelope',
		category: 'addressing',
		label: 'One letter per envelope',
		description: 'Envelopes containing letters for more than one prisoner are returned.'
	},
	{
		tag: 'registered_post_recommended',
		category: 'addressing',
		label: 'Registered post recommended',
		description:
			'Ordinary international post is often lost; send letters by registered or tracked mail.'
	},
	{
		tag: 'plain_paper',
		category: 'paper_and_ink',
		label: 'Plain paper only',
		description: 'White lined or unlined paper; no cardstock, construction paper, or scented paper.'
	},
	{
		tag: 'ink_blue_or_black',
		category: 'paper_and_ink',
		label: 'Blue or black ink only',
		description: 'Letters written in pencil, marker, crayon, or coloured ink are rejected.'
	},
	{
		tag: 'typed_letters_allowed',
		category: 'paper_and_ink',
		label: 'Typed letters allowed',
		description: 'Typed and printed letters are accepted as long as the pages are unbound.'
	},
	{
		tag: 'handwritten_only',
		category: 'paper_and_ink',
		label: 'Handwritten letters only',
		description: 'Typed or printed letters are refused; write by hand.'
	},
	{
		tag: 'postcards_only',
		category: 'paper_and_ink',
		label: 'Postcards only',
		description:
			'This facility accepts standard-size postcards only; enclosed letters are returned.'
	},
	{
		tag: 'no_greeting_cards',
		category: 'paper_and_ink',
		label: 'No greeting cards',
		description:
			'Cards with layers, glitter, pop-ups, or musical parts are refused; a flat card is accepted.'
	},
	{
		tag: 'no_scents_or_lipstick',
		category: 'paper_and_ink',
		label: 'No perfume or lipstick',
		description:
			'Scented, stained, or lipstick-marked paper is treated as contaminated and destroyed.'
	},
	{
		tag: 'no_glue_tape_or_staples',
		category: 'paper_and_ink',
		label: 'No glue, tape, or staples',
		description: 'Nothing may be glued, taped, or stapled to the pages.'
	},
	{
		tag: 'no_maps',
		category: 'content',
		label: 'No maps',
		description: 'Maps, including hand-drawn ones, are treated as escape material and confiscated.'
	},
	{
		tag: 'no_coded_messages',
		category: 'content',
		label: 'No coded messages',
		description:
			'Letters containing ciphers, symbols, or unexplained abbreviations are held for investigation.'
	},
	{
		tag: 'no_drawings_by_others',
		category: 'content',
		label: 'No drawings by others',
		description:
			'Hand-drawn artwork is accepted only from the sender; drawings by children or others are refused.'
	},
	{
		tag: 'no_third_party_mail',
		category: 'content',
		label: 'No third-party mail',
		description: 'Mail that forwards or relays a message from someone else is refused.'
	},
	{
		tag: 'no_photos',
		category: 'photos',
		label: 'No pictures',
		description: 'Letters must be text only; photographs and printed images are returned.'
	},
	{
		tag: 'no_polaroids',
		category: 'photos',
		label: 'No polaroids',
		description: 'Instant-film photographs are refused because the backing can hide contraband.'
	},
	{
		tag: 'no_explicit_photos',
		category: 'photos',
		label: 'No nude or suggestive photos',
		description:
			'Photographs showing nudity, underwear, or sexually suggestive poses are destroyed.'
	},
	{
		tag: 'no_gang_imagery',
		category: 'photos',
		label: 'No gang signs in photos',
		description: 'Photographs showing hand signs, gang colours, or gang tattoos are refused.'
	},
	{
		tag: 'no_enclosures',
		category: 'enclosures',
		label: 'Nothing enclosed',
		description:
			'Nothing may be enclosed with a letter: no stamps, cash, cards, or objects of any kind.'
	},
	{
		tag: 'no_stamps_enclosed',
		category: 'enclosures',
		label: 'Stamps not accepted',
		description: 'Enclosed postage stamps are confiscated; stamps must be bought at the commissary.'
	},
	{
		tag: 'no_money',
		category: 'enclosures',
		label: 'No money orders',
		description: "Funds cannot be sent by mail; use the facility's deposit service."
	},
	{
		tag: 'no_clippings',
		category: 'enclosures',
		label: 'No newspaper clippings',
		description:
			'Cuttings and printed articles are refused; write out or describe the content instead.'
	},
	{
		tag: 'printed_pages_allowed',
		category: 'enclosures',
		label: 'Printed internet pages allowed',
		description:
			'Printed web pages are accepted if they are plain black-and-white text with no images.'
	},
	{
		tag: 'books_from_publisher_only',
		category: 'publications',
		label: 'Books from publishers only',
		description:
			'Books must ship new from a publisher or approved bookseller, never from an individual.'
	},
	{
		tag: 'paperbacks_only',
		category: 'publications',
		label: 'Paperbacks only',
		description: 'Hardcover books are refused; send paperback editions.'
	},
	{
		tag: 'approved_senders_only',
		category: 'senders',
		label: 'No unknown senders',
		description: "Only senders on the prisoner's approved correspondence list are delivered."
	},
	{
		tag: 'sender_approval_form',
		category: 'senders',
		label: 'Sender approval form',
		description:
			"New correspondents must file the facility's approval form before their first letter is delivered."
	},
	{
		tag: 'no_inter_prisoner_mail',
		category: 'senders',
		label: 'No mail between prisoners',
		description:
			'Correspondence with anyone held in another facility requires prior written approval.'
	},
	{
		tag: 'mail_read_by_staff',
		category: 'handling',
		label: 'Mail opened and read',
		description: 'All incoming mail except legal mail is opened and read by staff before delivery.'
	},
	{
		tag: 'legal_mail_marked',
		category: 'handling',
		label: 'Legal mail marked clearly',
		description:
			"Mail from a lawyer must be marked Legal Mail with the firm's address or it is opened as ordinary mail."
	},
	{
		tag: 'originals_destroyed',
		category: 'handling',
		label: 'Scanned, not delivered',
		description:
			'Incoming mail is scanned by a vendor and shown on a tablet; the paper original is destroyed.'
	},
	{
		tag: 'scanned_in_greyscale',
		category: 'handling',
		label: 'Scanned mail: no colour',
		description:
			'Because mail is scanned in greyscale, colour drawings and photos arrive as black and white.'
	},
	{
		tag: 'digital_mail_only',
		category: 'handling',
		label: 'Digital mail only',
		description:
			"Letters must be sent through the facility's electronic mail service; postal mail is returned."
	},
	{
		tag: 'delivery_not_confirmed',
		category: 'handling',
		label: 'Delivery not confirmed',
		description: 'The facility does not confirm delivery; expect delays of four to eight weeks.'
	},
	{
		tag: 'holiday_card_limit',
		category: 'handling',
		label: 'Holiday mail limits',
		description: 'In December only, up to two cards per sender are accepted.'
	}
];

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

export async function up({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	const now = new Date();
	await queryInterface.createTable('MailRules', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		tag: { type: DataTypes.STRING, allowNull: false, unique: true },
		category: { type: DataTypes.STRING, allowNull: false },
		label: { type: DataTypes.STRING, allowNull: false },
		description: { type: DataTypes.TEXT },
		retiredAt: { type: DataTypes.DATE },
		createdBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.createTable('PrisonMailRules', {
		prison: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			...ref('Prisons', 'CASCADE')
		},
		// A rule that facilities still carry cannot be deleted; retire it instead.
		rule: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			...ref('MailRules', 'RESTRICT')
		},
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.bulkInsert(
		'MailRules',
		RULES.map((rule) => ({ ...rule, createdAt: now, updatedAt: now }))
	);

	const [rules] = await sequelize.query('SELECT `id`, `tag` FROM `MailRules`');
	const idOf = new Map(rules.map((r) => [r.tag, r.id]));
	const [prisons] = await sequelize.query('SELECT `id`, `mailRules` FROM `Prisons`');
	for (const prison of prisons) {
		const tags = [...new Set(parse(prison.mailRules) || [])];
		const links = tags.filter((tag) => idOf.has(tag));
		if (links.length > 0) {
			await queryInterface.bulkInsert(
				'PrisonMailRules',
				links.map((tag) => ({
					prison: prison.id,
					rule: idOf.get(tag),
					createdAt: now,
					updatedAt: now
				}))
			);
		}
		// The application refused unknown tags, so there should be none; keep the words if there are.
		const unknown = tags.filter((tag) => !idOf.has(tag));
		if (unknown.length > 0) {
			await sequelize.query(
				"UPDATE `Prisons` SET `notes` = TRIM(COALESCE(`notes`, '') || :addition, char(10)) WHERE `id` = :id",
				{
					replacements: {
						id: prison.id,
						addition: '\nMail rule tags not in the master list: ' + unknown.join(', ')
					}
				}
			);
		}
	}

	const { withForeignKeysOff } = await import('../migration-helpers.js');
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('Prisons', 'mailRules');
	});
}

export async function down({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	await queryInterface.addColumn('Prisons', 'mailRules', {
		type: DataTypes.JSON,
		allowNull: false,
		defaultValue: []
	});
	const [links] = await sequelize.query(
		'SELECT p.`prison` AS prison, r.`tag` AS tag FROM `PrisonMailRules` p JOIN `MailRules` r ON r.`id` = p.`rule` ORDER BY p.`prison`, r.`id`'
	);
	const byPrison = new Map();
	for (const link of links) {
		byPrison.set(link.prison, [...(byPrison.get(link.prison) || []), link.tag]);
	}
	for (const [id, tags] of byPrison) {
		await sequelize.query('UPDATE `Prisons` SET `mailRules` = :tags WHERE `id` = :id', {
			replacements: { id, tags: JSON.stringify(tags) }
		});
	}
	await queryInterface.dropTable('PrisonMailRules');
	await queryInterface.dropTable('MailRules');
}
