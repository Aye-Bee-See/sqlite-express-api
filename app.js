import express from 'express';
import passport from 'passport';
import { default as bodyParser } from 'body-parser';
import cors from 'cors';
import { encryptionMode, corsOrigins, trustProxy, quietBoot } from '#constants';
import { default as authRouter } from '#routes/user/user.js';
import prisonRoutes from '#routes/prison/prison.js';
import PrisonerRoutes from '#routes/prisoner/prisoner.js';
import MessageRoutes from '#routes/message/message.js';
import ChatRoutes from '#routes/chat/chat.js';
import ChapterRoutes from '#routes/chapter/chapter.js';
import ModerationRoutes from '#routes/moderation/moderation.js';
import InvitationRoutes from '#routes/invitation/invitation.js';
import NotificationRoutes from '#routes/notification/notification.js';
import * as push from '#services/push.js';
import KeysRoutes from '#routes/keys/keys.js';
import ErrorService from '#rtServices/error.services.js';
import '#rtServices/auth.services.js'; // registers the passport strategies
import { NotFoundError } from '#services/HttpError.js';
import { ready } from '#db/sql-database.js';

/**
 * Build the Express application without listening on a port.
 *
 * index.js calls this and listens; tests call it and drive it on an
 * ephemeral port. Importing this module still triggers database setup
 * (see database/sql-database.js); await `ready` before sending requests
 * that need data.
 *
 * @returns {import('express').Express}
 */
export function createApp() {
	const app = express();
	// Loads the FCM key when one is configured; without it devices register and nothing rings.
	push.configure(quietBoot ? () => {} : console.log);
	// Behind a reverse proxy, TRUST_PROXY makes req.ip the client address (rate limits key on it).
	app.set('trust proxy', trustProxy);

	// CORS before any routes are defined
	app.use(
		cors({
			origin: corsOrigins,
			methods: 'GET, POST, OPTIONS, PUT, PATCH, DELETE',
			allowedHeaders: 'X-Requested-With,content-type, authorization, idempotency-key',
			// Without this a browser hides them from the page's script.
			exposedHeaders: 'Idempotent-Replayed, Retry-After',
			credentials: false
		})
	);

	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({ extended: true }));
	app.use(passport.initialize());

	// Liveness/readiness: 200 once the database is synced and seeded, 503 before.
	let databaseReady = false;
	ready.then(() => {
		databaseReady = true;
	});
	app.get('/health', (req, res) => {
		// encryptionMode lets a client refuse to post plaintext to an e2e server.
		res
			.status(databaseReady ? 200 : 503)
			// push: the services this API can send through today; [] means devices
			// may register and nothing will ring.
			.json({ status: databaseReady ? 'ok' : 'starting', encryptionMode, push: push.available() });
	});

	app.use('/auth', authRouter.Router);
	app.use('/auth', KeysRoutes.Router);
	app.use('/auth', NotificationRoutes.Router);
	app.use('/prison', prisonRoutes.Router);
	app.use('/prisoner', PrisonerRoutes.Router);
	app.use('/messaging', MessageRoutes.Router);
	app.use('/chat', ChatRoutes.Router);
	app.use('/chapter', ChapterRoutes.Router);
	app.use('/moderation', ModerationRoutes.Router);
	app.use('/invitation', InvitationRoutes.Router);

	// Unknown routes get a JSON 404 instead of Express's HTML page.
	app.use((req, res, next) => {
		next(new NotFoundError('Cannot ' + req.method + ' ' + req.path));
	});
	app.use(ErrorService.handler);

	return app;
}

export { ready };
