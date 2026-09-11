import express from 'express';
import { default as passport } from 'passport';
import { messageEnd } from '#routes/constants.js';
import { default as messageCrtlr } from '#rtControllers/message.controller.js';
import { uploadSingle } from '#rtServices/upload.services.js';

class MessageRoutes {
	static Router;
	static #Controller;

	/************************************************************
	 *                                                          *
	 *                  STATIC INIT BLOCK                       *
	 *                                                          *
	 *   Initialize all necessary parts of the class            *
	 ************************************************************/
	static {
		this.#Controller = new messageCrtlr();
		this.Router = express.Router();

		this.#router();
	}
	/***
	 *
	 *   Handle router params
	 *
	 ***/
	static #router() {
		// Create

		this.Router.post(
			messageEnd.post.create,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.create
		);

		/********************************************************************************
		 * NOTE:
		 *      Authorization for edit/read/update may
		 *      require user specific authority
		 *      (e.g. userA should not be able to
		 *      delete, edit or read userB's messages)
		 ********************************************************************************/

		// Read

		this.Router.get(
			messageEnd.get.many,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.getMany
		);
		this.Router.get(
			messageEnd.get.one,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.getOne
		);

		// Update

		this.Router.put(
			messageEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.update
		);
		this.Router.put(
			messageEnd.put.updateStatus,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.updateStatus
		);
		// Attachments
		const authenticate = passport.authenticate('UsrJStrat', {
			session: false,
			failWithError: true
		});
		this.Router.post(
			messageEnd.attachment.create,
			authenticate,
			uploadSingle('file'),
			this.#Controller.createAttachment
		);
		this.Router.get(messageEnd.attachment.many, authenticate, this.#Controller.attachments);
		this.Router.get(messageEnd.attachment.one, authenticate, this.#Controller.getAttachment);
		this.Router.delete(
			messageEnd.attachment.remove,
			authenticate,
			this.#Controller.removeAttachment
		);

		// Delete
		this.Router.delete(
			messageEnd.delete.remove,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.remove
		);
	}
}

export default MessageRoutes;
