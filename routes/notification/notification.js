import express from 'express';
import { default as passport } from 'passport';
import { notificationEnd } from '#routes/constants.js';
import { default as notificationCtrlr } from '#rtControllers/notification.controller.js';

/** Devices and the notification feed, mounted under /auth. Every route is the caller's own data. */
class NotificationRoutes {
	static Router;
	static #Controller;

	static {
		this.#Controller = new notificationCtrlr();
		this.Router = express.Router();
		this.#router();
	}

	static #router() {
		const authenticate = passport.authenticate('UsrJStrat', {
			session: false,
			failWithError: true
		});
		this.Router.post(notificationEnd.post.create, authenticate, this.#Controller.create);
		this.Router.get(notificationEnd.get.one, authenticate, this.#Controller.getOne);
		this.Router.put(notificationEnd.put.updateDevice, authenticate, this.#Controller.updateDevice);
		this.Router.delete(notificationEnd.delete.remove, authenticate, this.#Controller.remove);

		this.Router.get(notificationEnd.get.many, authenticate, this.#Controller.getMany);
		this.Router.put(notificationEnd.put.update, authenticate, this.#Controller.update);
	}
}

export default NotificationRoutes;
