/**
 * Indexes for the tables that grow: letters, threads, envelopes. SQLite
 * indexes primary keys and UNIQUE columns only, never foreign keys, and
 * until now Messages and Chats had nothing else. Measured on 300,000
 * letters in 30,000 threads: a writer's inbox went from 99 ms to 0.03 ms,
 * one thread's letters from 9 ms to 0.01 ms, a group's envelopes from 7 ms
 * to 0.01 ms. Every query shares one connection, so those milliseconds
 * were the API's ceiling.
 *
 * Each index is named for the query it serves.
 */
const INDEXES = [
	// The inbox orders threads by their latest letter: MAX(createdAt) per chat.
	['Messages', ['chat', 'createdAt'], 'messages_chat_created'],
	// A writer's own letters (their scope on every messages read).
	['Messages', ['user'], 'messages_user'],
	// A group's print queue, and "letters this group relays" in its scope.
	['Messages', ['relayChapter', 'status'], 'messages_relay_status'],
	// Replies on a prisoner's threads; the relayed-reply check when recording one.
	['Messages', ['prisoner', 'user'], 'messages_prisoner_user'],
	// Retention: mailed letters older than the window.
	['Messages', ['status', 'statusChangedAt'], 'messages_status_changed'],
	// Finding (or creating) the thread for a writer and a prisoner, on every send.
	['Chats', ['user', 'prisoner'], 'chats_user_prisoner'],
	['Chats', ['prisoner'], 'chats_prisoner'],
	// A letter's status history.
	['MessageStatuses', ['message'], 'message_statuses_message'],
	// Envelopes a reader holds: a group's scope in e2e mode, rotation material, catch-up.
	// `message` makes it covering for "which letters does this reader hold an envelope for".
	['LetterKeys', ['readerType', 'readerId', 'message'], 'letter_keys_reader'],
	// Members of a group (notifications, key hand-over, readiness) and its accounts.
	['User', ['chapterId'], 'user_chapter'],
	// Prisoners held at a facility.
	['Prisoners', ['prison'], 'prisoners_prison'],
	// The writers list shows each writer's live hand-off token; issue and revoke look up by writer too.
	['ClaimTokens', ['userId'], 'claim_tokens_user'],
	// Children of letters, threads, and proposals: without these, deleting one
	// letter (retention does it by the thousand) scans all notifications.
	['Notifications', ['message'], 'notifications_message'],
	['Notifications', ['chat'], 'notifications_chat'],
	['Notifications', ['submission'], 'notifications_submission'],
	// Signing out forgets the device that session registered.
	['Devices', ['sessionId'], 'devices_session'],
	// The facilities a group relays for (its primary key leads with the facility).
	['PrisonRelay', ['chapter'], 'prison_relay_chapter']
];

export async function up({ context: queryInterface }) {
	for (const [table, fields, name] of INDEXES) {
		await queryInterface.addIndex(table, fields, { name });
	}
	// Let the planner see the real shape of the data it already holds.
	await queryInterface.sequelize.query('ANALYZE');
}

export async function down({ context: queryInterface }) {
	for (const [table, , name] of [...INDEXES].reverse()) {
		await queryInterface.removeIndex(table, name);
	}
}
