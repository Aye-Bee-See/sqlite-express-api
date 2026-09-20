import * as push from '#services/push.js';

/**
 * Does Google accept this server's push credentials?
 *
 *   npm run push:check                      a fake token: proves the key and the request, rings nothing
 *   npm run push:check -- <token> [platform]   a real device token: rings that device ("sync")
 *
 * With a fake token the only good answer is "that token is not valid":
 * Google can say so only after it has accepted the service account and
 * understood the request. Nothing is delivered to anyone.
 */

const [token = 'push-check-this-is-not-a-real-device-token', platform = 'android'] =
	process.argv.slice(2);
const real = process.argv.length > 2;

push.configure(console.log);
const fcm = push.provider('fcm');
if (!fcm) {
	console.log(
		'Not configured: set FCM_SERVICE_ACCOUNT_FILE in .env (see README, "Push notifications").'
	);
	process.exit(1);
}

try {
	const result = await fcm.send({ provider: 'fcm', platform, token });
	if (result.ok) {
		console.log('Sent. Google accepted the message' + (real ? '; the device should ring.' : '.'));
	} else if (['INVALID_ARGUMENT', 'UNREGISTERED'].includes(result.error)) {
		console.log(
			real
				? 'Google accepted the credentials but not this token (' +
						result.error +
						'): it is not a current registration token for this Firebase project.'
				: 'OK. Google accepted the credentials and the request, and refused the fake token (' +
						result.error +
						') as it should. Nothing was delivered. Push is ready.'
		);
	} else {
		console.log('Google refused the request: ' + result.error + '.');
		if (/PERMISSION_DENIED|SERVICE_DISABLED|403/.test(result.error)) {
			console.log(
				'Check that "Firebase Cloud Messaging API (V1)" is enabled: Firebase console, Project settings, Cloud Messaging.'
			);
		}
		process.exitCode = 1;
	}
} catch (err) {
	console.log('Could not reach or sign in to Google: ' + err.message);
	process.exitCode = 1;
}
