import express from 'express';
import { default as passport } from 'passport';
import { prisonerEnd } from '#routes/constants.js';
import { default as prisonerCrtlr } from '#rtControllers/prisoner.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { photoMaxBytes } from '#constants';
import { uploadSingle } from '#rtServices/upload.services.js';
import { limiters } from '#rtServices/ratelimit.services.js';

class PrisonerRoutes {
	static Router;
	static #Controller;

	/************************************************************
	 *                                                          *
	 *                  STATIC INIT BLOCK                       *
	 *                                                          *
	 *   Initialize all necessary parts of the class            *
	 ************************************************************/
	static {
		this.#Controller = new prisonerCrtlr();
		this.Router = express.Router();

		this.#router();
	}
	/***
	 *
	 *   Handle router params
	 *
	 ***/
	static #router() {
		// Create: superadmins only. A group admin proposes through POST /moderation/submission
		// (decided 22 September 2026); the group's own links (relay, support) are still theirs.

		this.Router.post(
			prisonerEnd.post.create,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN),
			this.#Controller.create
		);

		// Read

		this.Router.get(
			prisonerEnd.get.many,
			AuthzService.optionalAuthenticate,
			this.#Controller.getMany
		);
		this.Router.get(
			prisonerEnd.get.filters,
			AuthzService.optionalAuthenticate,
			this.#Controller.filters
		);

		this.Router.get(
			prisonerEnd.get.one,
			AuthzService.optionalAuthenticate,
			this.#Controller.getOne
		);

		// Photos. Reading one is public, like the record it belongs to; adding or
		// replacing one is a superadmin or a group-owner admin (the controller says so).
		this.Router.get(
			prisonerEnd.get.photo,
			AuthzService.optionalAuthenticate,
			this.#Controller.photo
		);
		this.Router.post(
			prisonerEnd.post.photo,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			// Counted, and the uploader checked, before the file is read, so a refusal
			// costs no upload; and read only up to the photo limit, not the attachment one.
			limiters.photo,
			this.#Controller.photoEditor,
			uploadSingle('photo', { maxBytes: photoMaxBytes }),
			this.#Controller.createPhoto
		);
		this.Router.delete(
			prisonerEnd.delete.photo,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.removePhoto
		);

		// History: who changed this record and when. Staff only — it names people
		// and can carry staff-only field values.
		this.Router.get(
			prisonerEnd.get.history,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireGroupMember,
			this.#Controller.history
		);

		// Update

		this.Router.put(
			prisonerEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN),
			this.#Controller.update
		);

		// Support groups
		this.Router.put(
			prisonerEnd.put.addSupport,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.addSupport
		);
		this.Router.delete(
			prisonerEnd.delete.removeSupport,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.removeSupport
		);

		// Delete

		this.Router.delete(
			prisonerEnd.delete.remove,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN),
			this.#Controller.remove
		);
	}
}

export default PrisonerRoutes;
