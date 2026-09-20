/**
 * Letter lifecycle. Outgoing letters (sender `user`) move queued -> printed
 * -> mailed, driven by the relay group that prints them. Prisoner replies
 * (sender `prisoner`) are recorded as `received` and stay there.
 */

export const QUEUED = 'queued';
export const PRINTED = 'printed';
export const MAILED = 'mailed';
export const RECEIVED = 'received';

export const LETTER_STATUSES = [QUEUED, PRINTED, MAILED, RECEIVED];

/** Allowed forward moves. `received` is terminal and only ever initial. */
export const TRANSITIONS = {
	[QUEUED]: [PRINTED],
	[PRINTED]: [MAILED],
	[MAILED]: [],
	[RECEIVED]: []
};

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
