import { randomBytes } from 'node:crypto';

/** Print a fresh ENCRYPTION_KEY (32 random bytes, base64). */
console.log(randomBytes(32).toString('base64'));
