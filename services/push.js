import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { push as config } from '#constants';

/**
 * Push, content-free. A push is a doorbell: it tells a device that
 * something happened so the app can fetch what, over its own connection
 * (GET /auth/notifications). Everything sent here passes through Google
 * and Apple and can land on a lock screen, so it carries no letter
 * content, no names, no ids: nothing but "sync".
 *
 * Providers are pluggable (`use`) so another service can be added beside
 * FCM, and so tests can stand in for it.
 */

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** No request to a push service may hang: a doorbell is not worth waiting for. */
export const SEND_TIMEOUT_MS = 10_000;
/** Devices rung at once for one event. */
const PARALLEL_SENDS = 5;

/** The whole payload. Deliberately the same for every event. */
export const SYNC_DATA = Object.freeze({ type: 'sync' });

/**
 * What FCM is asked to deliver to one device.
 * - Android and web: data only, high priority (each in its own platform block;
 *   FCM ignores `android` for a browser); the app decides what to show.
 * - iOS: Apple throttles or drops silent pushes, so a visible, generic alert
 *   goes with it, marked mutable so the app's notification extension can
 *   fetch and reword it on the device.
 * One collapse key, so a burst of events rings once.
 */
export function fcmMessage(device) {
	const message = { token: device.token, data: { ...SYNC_DATA } };
	if (device.platform === 'ios') {
		message.apns = {
			headers: { 'apns-priority': '10', 'apns-push-type': 'alert', 'apns-collapse-id': 'sync' },
			payload: {
				aps: {
					alert: { title: config.iosAlertTitle, body: config.iosAlertBody },
					'mutable-content': 1,
					'content-available': 1
				}
			}
		};
	} else if (device.platform === 'web') {
		// FCM ignores the android block for Web Push; urgency and the collapse
		// "topic" travel as Web Push headers.
		message.webpush = { headers: { Urgency: 'high', Topic: 'sync' } };
	} else {
		message.android = { priority: 'high', collapse_key: 'sync' };
	}
	return { message };
}

/**
 * Firebase Cloud Messaging over its HTTP v1 API, with a service-account
 * key: no SDK, one signed JWT exchanged for a short-lived access token.
 * @param {{serviceAccount: {project_id: string, client_email: string, private_key: string}, fetch?: typeof fetch, now?: () => number, timeoutMs?: number}} options
 */
export function createFcmProvider({
	serviceAccount,
	fetch: fetchImpl = fetch,
	now = Date.now,
	timeoutMs = SEND_TIMEOUT_MS
}) {
	let cached = null; // { token, expiresAt }

	async function accessToken() {
		if (cached && cached.expiresAt - 60_000 > now()) {
			return cached.token;
		}
		const issued = Math.floor(now() / 1000);
		const assertion = jwt.sign(
			{
				iss: serviceAccount.client_email,
				scope: FCM_SCOPE,
				aud: GOOGLE_TOKEN_URL,
				iat: issued,
				exp: issued + 3600
			},
			serviceAccount.private_key,
			{ algorithm: 'RS256' }
		);
		const res = await fetchImpl(GOOGLE_TOKEN_URL, {
			method: 'POST',
			signal: AbortSignal.timeout(timeoutMs),
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				assertion
			}).toString()
		});
		if (!res.ok) {
			throw new Error('Google refused the service account (HTTP ' + res.status + ').');
		}
		const body = await res.json();
		cached = {
			token: body.access_token,
			expiresAt: now() + Number(body.expires_in || 3600) * 1000
		};
		return cached.token;
	}

	return {
		name: 'fcm',
		/**
		 * @returns {Promise<{ok: boolean, gone: boolean, error?: string}>} `gone`: the token is dead and should be forgotten
		 */
		async send(device) {
			const res = await fetchImpl(
				'https://fcm.googleapis.com/v1/projects/' + serviceAccount.project_id + '/messages:send',
				{
					method: 'POST',
					signal: AbortSignal.timeout(timeoutMs),
					headers: {
						Authorization: 'Bearer ' + (await accessToken()),
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(fcmMessage(device))
				}
			);
			if (res.ok) {
				return { ok: true, gone: false };
			}
			if (res.status === 401) {
				cached = null;
			}
			const body = await res.json().catch(() => ({}));
			const details = (body.error && body.error.details) || [];
			const code =
				(details.find((d) => d && d.errorCode) || {}).errorCode || (body.error || {}).status || '';
			// Only an unregistered token is forgotten. INVALID_ARGUMENT may be a bug in
			// this payload and SENDER_ID_MISMATCH a wrong key: neither is the device's fault.
			return { ok: false, gone: code === 'UNREGISTERED', error: code || 'HTTP ' + res.status };
		}
	};
}

const providers = new Map();
const inFlight = new Set();

/** Register (or replace) a provider. */
export function use(provider) {
	providers.set(provider.name, provider);
}

/** Remove a provider, or all of them. */
export function reset(name) {
	if (name) {
		providers.delete(name);
	} else {
		providers.clear();
	}
}

/** One configured provider, or undefined. For the push:check command. */
export function provider(name) {
	return providers.get(name);
}

/** The providers that can send right now, for GET /health. */
export function available() {
	return [...providers.keys()];
}

/** Load the FCM provider from FCM_SERVICE_ACCOUNT_FILE, when set. Called once at boot. */
export function configure(log = console.log, file = config.serviceAccountFile) {
	if (!file) {
		log('Push: no FCM_SERVICE_ACCOUNT_FILE; devices may register, nothing is sent.');
		return;
	}
	try {
		const serviceAccount = JSON.parse(readFileSync(file, 'utf8'));
		for (const field of ['project_id', 'client_email', 'private_key']) {
			if (typeof serviceAccount[field] !== 'string' || serviceAccount[field] === '') {
				throw new Error('missing ' + field);
			}
		}
		// A private key that cannot sign would only fail at the first push, after
		// devices had been told they are deliverable. Find out now.
		jwt.sign({ probe: true }, serviceAccount.private_key, { algorithm: 'RS256' });
		use(createFcmProvider({ serviceAccount }));
		log('Push: FCM ready for project ' + serviceAccount.project_id + '.');
	} catch (err) {
		// A bad key must not stop the API: letters matter more than doorbells.
		console.error('Push: FCM_SERVICE_ACCOUNT_FILE could not be used (' + err.message + ').');
	}
}

/**
 * Ring these devices. Never throws and never makes a request wait: the
 * write it announces has already happened. Events do not queue behind each
 * other, a few devices are rung at a time, and every request is bounded by
 * SEND_TIMEOUT_MS, so one slow device cannot hold up anyone else's doorbell.
 *
 * The device list is a snapshot, and a push token can change hands before
 * its turn comes (someone else signs in on that phone). So each device is
 * confirmed just before sending, and forgotten only as the row it was.
 *
 * @param {{id: number, userId: number, provider: string, platform: string, token: string}[]} devices
 * @param {{confirm: (device: object) => Promise<boolean>, forget: (device: object) => Promise<unknown>}} hooks
 *   `confirm`: is this still that account's unmuted device? `forget`: the service says the token is dead.
 */
export function ring(devices, { confirm, forget }) {
	const queue = [...devices];
	const sendOne = async (device) => {
		const provider = providers.get(device.provider);
		if (!provider) {
			return;
		}
		try {
			if (!(await confirm(device))) {
				return;
			}
			const result = await provider.send(device);
			if (result.gone) {
				await forget(device);
			} else if (!result.ok) {
				console.error('[push] ' + provider.name + ' refused a message: ' + result.error);
			}
		} catch (err) {
			console.error('[push] ' + provider.name + ' failed: ' + err.message);
		}
	};
	const worker = async () => {
		for (let device = queue.shift(); device; device = queue.shift()) {
			await sendOne(device);
		}
	};
	const work = Promise.all(
		Array.from({ length: Math.min(PARALLEL_SENDS, queue.length) }, worker)
	).then(() => {});
	inFlight.add(work);
	work.finally(() => inFlight.delete(work));
	return work;
}

/** Resolves when everything rung so far has been sent. For tests and shutdown. */
export async function idle() {
	while (inFlight.size > 0) {
		await Promise.all([...inFlight]);
	}
}
