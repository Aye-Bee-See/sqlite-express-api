import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	get,
	post,
	put,
	del,
	makeFixtures,
	Prison,
	sequelize
} from './helpers.js';
import MailRule from '../database/models/mail-rule.model.js';
import AuditLog from '../database/models/audit-log.model.js';

let f;
let admin;
let chapter;
let alice;

const addRule = (body, who = admin) => post('/prison/mail-rule', body, who);
const list = async (query = '', who = {}) =>
	(await get('/prison/mail-rules' + query, who)).body.data.rules;

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	chapter = { token: f.chapter.token };
	alice = { token: f.alice.token };
});
after(stopServer);

test('an admin adds a rule to the master list, and facilities can then carry it', async () => {
	const created = await addRule({
		tag: 'no_crayon',
		category: 'paper_and_ink',
		label: 'No crayon',
		description: 'Letters or drawings in crayon are refused.'
	});
	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.equal(created.body.data.tag, 'no_crayon');
	assert.equal(created.body.data.retired, false);
	assert.ok((await list()).some((rule) => rule.tag === 'no_crayon'));
	assert.ok(await AuditLog.findOne({ where: { action: 'mail-rule.create' } }));

	// Before it was on the list it was refused; now any staff member can use it.
	const tagged = await put(
		'/prison/prison',
		{ id: f.prison.id, mailRules: ['no_crayon'] },
		chapter
	);
	assert.equal(tagged.status, 200, JSON.stringify(tagged.body));
	const read = (await get('/prison/prison?id=' + f.prison.id)).body.data;
	assert.deepEqual(read.mailRules, ['no_crayon']);
	assert.equal(read.mail_rule_details[0].label, 'No crayon');
});

test('only admins change the master list', async () => {
	const body = { tag: 'no_glitter', category: 'paper_and_ink', label: 'No glitter' };
	assert.equal((await addRule(body, {})).status, 401);
	assert.equal((await addRule(body, alice)).status, 403);
	assert.equal(
		(await addRule(body, chapter)).status,
		403,
		'groups use the list; they do not edit it'
	);
	const [first] = await list();
	assert.equal((await put('/prison/mail-rule', { id: first.id, label: 'X' }, chapter)).status, 403);
	assert.equal((await del('/prison/mail-rule', { id: first.id }, chapter)).status, 403);
});

test('the same rule in other words is refused, with a pointer to the one that exists', async () => {
	const language = await addRule({
		tag: 'english_only',
		category: 'content',
		label: 'English only'
	});
	assert.equal(language.status, 201, JSON.stringify(language.body));

	const cases = [
		[{ tag: 'only_english', label: 'Letters in English' }, 'the words of the tag in another order'],
		[{ tag: 'english_only', label: 'Something else' }, 'the same tag'],
		[{ tag: 'en_mail', label: 'Only English' }, 'the words of the label in another order'],
		[{ tag: 'no_polaroid', label: 'Instant film refused' }, 'a singular for a plural'],
		[{ tag: 'polaroids_no', label: 'Instant film refused' }, 'both at once']
	];
	for (const [body, what] of cases) {
		const res = await addRule({ category: 'content', ...body });
		assert.equal(res.status, 409, what + ': ' + JSON.stringify(res.body));
		assert.equal(res.body.name, 'DuplicateRuleError');
		assert.match(res.body.error, /already has this rule as "(english_only|no_polaroids)"/);
	}
	assert.equal(await MailRule.count({ where: { tag: ['only_english', 'no_polaroid'] } }), 0);
});

test('new rules are validated', async () => {
	const cases = [
		[{ tag: 'No Glitter', category: 'paper_and_ink', label: 'No glitter' }, /lower_snake_case/],
		[{ tag: 'no-glitter', category: 'paper_and_ink', label: 'No glitter' }, /lower_snake_case/],
		[{ tag: 'no_glitter', category: 'sparkle', label: 'No glitter' }, /category must be one of/],
		[{ tag: 'no_glitter', category: 'paper_and_ink' }, /label/],
		[{ category: 'paper_and_ink', label: 'No glitter' }, /tag/],
		[{ tag: 'ng', category: 'paper_and_ink', label: 'No glitter' }, /3 to 40/]
	];
	for (const [body, message] of cases) {
		const res = await addRule(body);
		assert.equal(res.status, 400, JSON.stringify(body));
		assert.match(res.body.errors.join(' '), message);
	}
});

test('a rule can be reworded and recategorised; its tag never changes', async () => {
	const rule = (await list()).find((r) => r.tag === 'no_crayon');
	const reworded = await put(
		'/prison/mail-rule',
		{ id: rule.id, label: 'No crayon or chalk', category: 'content' },
		admin
	);
	assert.equal(reworded.status, 200, JSON.stringify(reworded.body));
	assert.equal(reworded.body.data.label, 'No crayon or chalk');
	assert.equal(reworded.body.data.category, 'content');
	assert.equal(reworded.body.data.prisons, 1, 'how many facilities carry it');
	// The facility that has it shows the new wording at once: it holds a link, not a copy.
	const read = (await get('/prison/prison?id=' + f.prison.id)).body.data;
	assert.equal(read.mail_rule_details[0].label, 'No crayon or chalk');

	const retagged = await put('/prison/mail-rule', { id: rule.id, tag: 'no_chalk' }, admin);
	assert.equal(retagged.status, 409);
	assert.equal(retagged.body.name, 'RuleTagError');
	const stolen = await put('/prison/mail-rule', { id: rule.id, label: 'No Polaroids' }, admin);
	assert.equal(stolen.status, 409, 'cannot take the wording of another rule');
	assert.equal(
		(await put('/prison/mail-rule', { id: 999999, label: 'Nothing' }, admin)).status,
		404
	);
	assert.equal(
		(await put('/prison/mail-rule', { id: rule.id, retired: 'yes' }, admin)).status,
		400
	);
});

test('a rule in use is retired, not deleted; a retired rule stays where it is and goes nowhere new', async () => {
	const rule = (await list()).find((r) => r.tag === 'no_crayon');
	const refused = await del('/prison/mail-rule', { id: rule.id }, admin);
	assert.equal(refused.status, 409);
	assert.equal(refused.body.name, 'RuleInUseError');
	assert.match(refused.body.error, /1 facility carries this rule/);

	const retired = await put('/prison/mail-rule', { id: rule.id, retired: true }, admin);
	assert.equal(retired.status, 200);
	assert.equal(retired.body.data.retired, true);
	assert.ok(!(await list()).some((r) => r.tag === 'no_crayon'), 'gone from the list pickers use');
	assert.ok((await list('?retired=true', admin)).some((r) => r.tag === 'no_crayon'));
	assert.ok(
		!(await list('?retired=true')).some((r) => r.tag === 'no_crayon'),
		'the public never sees retired rules on the list'
	);

	// The facility keeps it, can be edited while keeping it, and no other facility can take it.
	const still = (await get('/prison/prison?id=' + f.prison.id)).body.data;
	assert.deepEqual(still.mailRules, ['no_crayon']);
	const kept = await put(
		'/prison/prison',
		{ id: f.prison.id, mailRules: ['no_crayon', 'no_maps'] },
		admin
	);
	assert.equal(kept.status, 200, JSON.stringify(kept.body));
	const other = await Prison.createPrison({ prisonName: 'Elsewhere', address: {} });
	const added = await put('/prison/prison', { id: other.id, mailRules: ['no_crayon'] }, admin);
	assert.equal(added.status, 400);
	assert.match(added.body.errors[0], /Retired rules cannot be added/);

	// Dropped from its last facility, it can be deleted.
	await put('/prison/prison', { id: f.prison.id, mailRules: ['no_maps'] }, admin);
	const removed = await del('/prison/mail-rule', { id: rule.id }, admin);
	assert.equal(removed.status, 200, JSON.stringify(removed.body));
	assert.equal(await MailRule.count({ where: { tag: 'no_crayon' } }), 0);
	assert.equal((await del('/prison/mail-rule', { id: rule.id }, admin)).status, 404);
});

test('the database itself refuses a link to a rule that does not exist, and a duplicate tag', async () => {
	const now = "datetime('now'), datetime('now')";
	await assert.rejects(
		sequelize.query(
			'INSERT INTO PrisonMailRules (prison, rule, createdAt, updatedAt) VALUES (:prison, 999999, ' +
				now +
				')',
			{ replacements: { prison: f.prison.id } }
		),
		/FOREIGN KEY/
	);
	await assert.rejects(
		sequelize.query(
			"INSERT INTO MailRules (tag, category, label, createdAt, updatedAt) VALUES ('no_maps', 'content', 'Maps again', " +
				now +
				')'
		),
		(err) => err.name === 'SequelizeUniqueConstraintError'
	);
	const inUse = await MailRule.findOne({ where: { tag: 'no_maps' } });
	await assert.rejects(
		inUse.destroy(),
		/FOREIGN KEY/,
		'a rule a facility carries cannot be deleted'
	);
});

test('embedded facilities carry their rules too', async () => {
	await put('/prison/prison', { id: f.prison.id, mailRules: ['no_maps', 'plain_paper'] }, admin);
	const prisoner = await get('/prisoner/prisoner?id=' + f.prisoner1.id + '&full=true');
	assert.deepEqual(prisoner.body.data.prison_details.mailRules, ['plain_paper', 'no_maps']);
	assert.equal(prisoner.body.data.prison_details.mail_rule_details.length, 2);

	await put('/prison/relay', { prison: f.prison.id, chapter: f.group.id }, admin);
	const group = await get('/chapter/chapter?id=' + f.group.id + '&full=true');
	assert.deepEqual(group.body.data.relay_prisons[0].mailRules, ['plain_paper', 'no_maps']);

	const listed = await get('/prison/prisons?full=true&page_size=100');
	const row = listed.body.data.find((p) => p.id === f.prison.id);
	assert.deepEqual(row.mailRules, ['plain_paper', 'no_maps']);
	assert.equal(listed.body.total, await Prison.count(), 'rules do not inflate the count');
});

test('deleting a facility removes its links, not the rules', async () => {
	const doomed = await Prison.createPrison({
		prisonName: 'Doomed',
		address: {},
		mailRules: ['no_maps']
	});
	const before = await MailRule.count();
	assert.equal((await del('/prison/prison', { id: doomed.id }, admin)).status, 200);
	assert.equal(await MailRule.count(), before);
	const [[{ n }]] = await sequelize.query(
		'SELECT COUNT(*) AS n FROM PrisonMailRules WHERE prison = :id',
		{ replacements: { id: doomed.id } }
	);
	assert.equal(n, 0);
});
