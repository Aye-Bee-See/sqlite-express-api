/**
 * Letter lifecycle. Outgoing letters (sender `user`) move queued -> printed
 * -> mailed, driven by the relay group that prints them; a mailed letter that
 * comes back is `returned`, with the reason. Prisoner replies (sender
 * `prisoner`) are recorded as `received` and stay there.
 */

export const QUEUED = 'queued';
export const PRINTED = 'printed';
export const MAILED = 'mailed';
export const RECEIVED = 'received';
export const RETURNED = 'returned';

export const LETTER_STATUSES = [QUEUED, PRINTED, MAILED, RECEIVED, RETURNED];

/** Allowed forward moves. `received` is terminal and only ever initial; `returned` is terminal. */
export const TRANSITIONS = {
	[QUEUED]: [PRINTED],
	[PRINTED]: [MAILED],
	[MAILED]: [RETURNED],
	[RECEIVED]: [],
	[RETURNED]: []
};

/**
 * Why the post brought a letter back. Codes, so that clients word them in the
 * reader's language and the directory can count them.
 */
export const RETURN_REASONS = [
	'refused', // the mail room would not pass it on, no rule named
	'rule_violation', // it broke one of the facility's mail rules
	'transferred', // the person is held somewhere else now
	'released', // the person is no longer held
	'bad_address', // undeliverable as addressed
	'unknown' // it came back and nothing says why
];

/** The reasons that say the directory's address for this person may be wrong. */
export const ADDRESS_RETURN_REASONS = ['transferred', 'released', 'bad_address'];

/** Statuses that end a letter's journey: what retention counts from, and may remove. */
export const SETTLED_STATUSES = [MAILED, RECEIVED, RETURNED];

/** The status a new message starts in, from its sender. */
export function initialStatusFor(sender) {
	return sender === 'prisoner' ? RECEIVED : QUEUED;
}

export function canTransition(from, to) {
	return Boolean(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

/** The statuses in which a letter is still its writer's to edit or delete. */
export const OPEN_STATUSES = [QUEUED, RECEIVED];

/** Is the letter still editable by its writer (nothing has been printed)? */
export function isOpen(status) {
	return OPEN_STATUSES.includes(status);
}
