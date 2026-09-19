import { createSerialQueue } from '#services/serial.js';

/**
 * One queue for everything that depends on a group's key staying put while
 * it works: rotations, and the writes that are checked against the key
 * version and then stored (a managed writer's group-sealed key, removing a
 * key holder). Run through here, a check and its write cannot straddle a
 * rotation, and two removals cannot both see "one holder to spare".
 *
 * In-process (see services/serial.js); an in-memory database (tests) also
 * has a single connection that cannot nest transactions.
 */
export const withGroupKeyLock = createSerialQueue();
