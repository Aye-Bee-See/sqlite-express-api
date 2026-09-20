import Prisoner from '#models/prisoner.model.js';
import Chat from '#models/chat.model.js';
import Message from '#models/message.model.js';
import ValidationError from '#services/ValidationError.js';
import * as crypto from '#services/crypto.js';
import { QUEUED, HELD_CHOOSE_RELAY, HELD_PRISONER_FREE, HELD_RESEAL } from '#db/letter-status.js';
import { notify, membersOf } from '#rtServices/notify.services.js';
import { audit } from '#rtServices/audit.services.js';

/**
 * What happens to people's mail when the directory learns that a prisoner was
 * moved or freed. Every path that edits a prisoner (a direct edit, an approved
 * proposal) calls watchPrisoner() before the write and afterPrisonerChange()
 * after it.
 *
 * Moved to another facility:
 * - everyone with a thread to them is told (`prisoner.moved`);
 * - their letters still queued go where a new letter would go now. The group
 *   that was going to mail one keeps it if it serves the new facility too;
 *   otherwise the letter is routed again, and the new group is told. Where the
 *   writer has to choose (a relay-only facility with several groups, or none),
 *   and in end-to-end mode where the letter is sealed to the old group and the
 *   server cannot re-seal it, the letter is held instead.
 *
 * Freed (`status: free`): everyone is told (`prisoner.status`) and queued
 * letters are held: printing and posting a letter to a prison someone has left
 * wastes an evening, and it may never be forwarded. Held again as incarcerated
 * or pretrial, those holds are lifted.
 *
 * Never throws: the directory edit is committed, and must not be reported as failed.
 */

/** @returns {Promise<{id: number, prison: number, status: string|null}|null>} */
export async function watchPrisoner(id) {
	if (id === undefined || id === null || typeof id === 'object') {
		return null;
	}
	const row = await Prisoner.findByPk(id, { attributes: ['id', 'prison', 'status'] });
	return row ? { id: row.id, prison: row.prison, status: row.status } : null;
}

/** Where a queued letter goes now, or why it has to wait. */
async function routeAgain(letter, relayIds) {
	if (letter.relayChapter && relayIds.includes(letter.relayChapter)) {
		return { relayChapter: letter.relayChapter, heldReason: null };
	}
	if (crypto.isE2E()) {
		// Sealed to the group that was going to mail it (if any) and the writer. The
		// server cannot seal it to another group: the writer's client sends it again.
		return { relayChapter: letter.relayChapter, heldReason: HELD_RESEAL };
	}
	try {
		const relayChapter = await Message.resolveRelayChapter(letter.prisoner, undefined, null);
		return { relayChapter, heldReason: null };
	} catch (err) {
		if (!(err instanceof ValidationError)) {
			throw err;
		}
		return { relayChapter: letter.relayChapter, heldReason: HELD_CHOOSE_RELAY };
	}
}

async function queuedLettersTo(prisonerId) {
	return await Message.findAll({
		where: { prisoner: prisonerId, status: QUEUED, sender: 'user' },
		attributes: ['id', 'chat', 'user', 'prisoner', 'relayChapter', 'heldReason'],
		hooks: false
	});
}

/**
 * @param {object} req the request that made the change (its user is the actor)
 * @param {{id: number, prison: number, status: string|null}|null} before from watchPrisoner()
 * @returns {Promise<{moved: boolean, freed: boolean, rerouted: number, held: number, released: number}|null>}
 *   `held` and `released` count what this change did; each writer's notification carries how many
 *   of their letters are waiting afterwards, whenever they were held.
 */
export async function afterPrisonerChange(req, before) {
	if (!before) {
		return null;
	}
	const report = { moved: false, freed: false, rerouted: 0, held: 0, released: 0 };
	try {
		const after = await Prisoner.findByPk(before.id, { attributes: ['id', 'prison', 'status'] });
		if (!after) {
			return null;
		}
		report.moved = String(after.prison) !== String(before.prison);
		report.freed = after.status === 'free' && before.status !== 'free';
		const heldAgain = before.status === 'free' && after.status !== 'free';
		if (!report.moved && !report.freed && !heldAgain) {
			return report;
		}
		const actor = req && req.user ? req.user.id : null;
		const letters = await queuedLettersTo(after.id);
		// Per thread, how many queued letters are waiting once this is done: what each
		// writer is told. Not only the ones this edit held (that is report.held, for the
		// editor): a letter already waiting is still waiting.
		const waitingByChat = new Map();
		const waits = (letter) =>
			waitingByChat.set(letter.chat, (waitingByChat.get(letter.chat) || 0) + 1);
		const { relayIds } = report.moved ? await Prisoner.relayGroupsFor(after) : { relayIds: [] };

		for (const letter of letters) {
			let next = { relayChapter: letter.relayChapter, heldReason: letter.heldReason };
			if (report.moved) {
				next = await routeAgain(letter, relayIds);
			}
			if (after.status === 'free') {
				next.heldReason = HELD_PRISONER_FREE;
			} else if (heldAgain && letter.heldReason === HELD_PRISONER_FREE && !report.moved) {
				next.heldReason = null;
			}
			const rerouted = next.relayChapter !== letter.relayChapter;
			if (!rerouted && next.heldReason === letter.heldReason) {
				if (letter.heldReason) {
					waits(letter);
				}
				continue;
			}
			// Still queued at the moment of the write: a letter printed meanwhile is left alone.
			const [count] = await Message.update(
				{ relayChapter: next.relayChapter, heldReason: next.heldReason },
				{ where: { id: letter.id, status: QUEUED } }
			);
			if (count === 0) {
				continue;
			}
			if (rerouted) {
				report.rerouted += 1;
				await audit(req, 'letter.rerouted', 'message', letter.id, {
					from: letter.relayChapter,
					to: next.relayChapter,
					because: 'prisoner.moved'
				});
				await notify(
					await membersOf(next.relayChapter),
					{ event: 'letter.queued', chat: letter.chat, message: letter.id },
					{ actor }
				);
			}
			if (next.heldReason) {
				waits(letter);
			}
			if (next.heldReason && !letter.heldReason) {
				report.held += 1;
			} else if (!next.heldReason && letter.heldReason) {
				report.released += 1;
			}
		}

		if (report.moved || report.freed) {
			const threads = await Chat.findAll({
				where: { prisoner: after.id },
				attributes: ['id', 'user']
			});
			for (const thread of threads) {
				const held = waitingByChat.get(thread.id) || 0;
				if (report.moved) {
					await notify(
						[thread.user],
						{
							event: 'prisoner.moved',
							chat: thread.id,
							detail: { prisoner: after.id, prison: after.prison, held }
						},
						{ actor }
					);
				}
				if (report.freed) {
					await notify(
						[thread.user],
						{
							event: 'prisoner.status',
							chat: thread.id,
							detail: { prisoner: after.id, status: after.status, held }
						},
						{ actor }
					);
				}
			}
		}
		return report;
	} catch (err) {
		console.error('[prisoner change] the mail of prisoner ' + before.id + ' was not updated', err);
		return report;
	}
}
