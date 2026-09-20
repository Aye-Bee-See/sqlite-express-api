import { sysPort } from '#constants';
import { createApp, ready } from './app.js';

const app = createApp();

/** How long open requests get to finish after SIGTERM or SIGINT. */
const SHUTDOWN_GRACE_MS = 10_000;

// Listen right away so /health can answer 503 while the database is still
// being prepared, then report when the app is usable.
const server = app.listen(sysPort, function () {
	// PORT may be unset (a random free port): say the one that was bound.
	console.log('Express is running on port: ' + server.address().port);
});

ready.then(
	() => {
		console.log('Ready to serve requests.');
	},
	() => {
		// The reason was logged where it happened. A server that cannot reach its
		// database must not stay up answering 503 for ever: stop, so whatever runs
		// it (systemd, a container, a person) notices.
		console.error('Stopping: the database could not be prepared.');
		process.exitCode = 1;
		server.close();
	}
);

// Finish the requests in flight, then leave: a deploy or a restart should not cut
// a letter off half written.
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
	process.on(signal, () => {
		if (stopping) {
			return;
		}
		stopping = true;
		console.log(signal + ' received: finishing open requests.');
		server.close(() => process.exit(0));
		// Idle keep-alive connections would hold the server open.
		server.closeIdleConnections();
		setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
	});
}
