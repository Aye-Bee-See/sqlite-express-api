import Prisoner from "#models/prisoner.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
import {prisonerMsg} from '#routes/constants.js'
import {default as Utls} from "#services/Utilities.js"
import RouteController from "#rtControllers/route.controller.js";
import { getMulterUpload, renameFile } from '#services/multerService.js';
import path from 'path';

export default class PrisonerController extends RouteController {

    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        super("prisoner");
        this.getMany = this.getMany.bind(this);
        this.getOne = this.getOne.bind(this);
        this.update = this.update.bind(this);
        this.remove = this.remove.bind(this);
        this.create = this.create.bind(this);

        this.#handleErr = super.handleErr;
        this.#handleSuccess = super.handleSuccess;

    }

    #handleSuccess;
    #handleErr;
    
    async getMany(req, res, next) {
        const {prison} = req.query;
        if (prison) {
            this.getListByPrison(req, res);
        }
        else {
        try {
            const rules = await Prisoner.getAllPrisoners();
            this.#handleSuccess(res, rules);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    }

    async getListByPrison(req, res) {
        const {prison} = req.query;
        try {
            const prisoner = await Prisoner.getPrisonersByPrison(prison);
            this.#handleSuccess(res, prisoner);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    // get one prisoner

    async getOne(req, res) {
        const {id, full} = req.query;
        const fullBool = (full === 'true');
        try {
            const prisoner = await Prisoner.getPrisonerByID(id, fullBool);
            this.#handleSuccess(res, prisoner);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
    // Create
    async create(req, res) {
        const upload = getMulterUpload('uploads/avatars/prisoners', 'inmateID').single('avatar');
        upload(req, res, async (err) => {
            if (err) {
                return this.#handleErr(res, err)
            }
            const { birthName, chosenName, prison, inmateID, releaseDate, bio, status } = req.body;
            const tempAvatarPath = req.file ? req.file.path : null;
            try {
                const prisoner = await Prisoner.createPrisoner({ birthName, chosenName, prison, inmateID, releaseDate, bio, status, avatar: null });
                if (tempAvatarPath) {
                    const newAvatarPath = path.join('uploads/avatars/prisoners', `${prisoner.id}-${path.basename(tempAvatarPath)}`);
                    renameFile(tempAvatarPath, newAvatarPath);
                    prisoner.avatar = newAvatarPath;
                    await prisoner.save();
                }
                this.#handleSuccess(res, prisoner);
            } catch (err) {
                err = !(err instanceof Error) ? new Error(err) : err;
                this.#handleErr(res, err);
            }
        })
    }

    // Update

    async update(req, res)
    {
        const newPrisoner = req.body;
        try {
            const updatedRows = await Prisoner.updatePrisoner(newPrisoner);
            this.#handleSuccess(res, {updatedRows, newPrisoner});
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

// Delete
    async remove(req, res)
    {
        const {id} = req.body;
        try {
            const deletedRows = await Prisoner.deletePrisoner(id);
            this.#handleSuccess(res, deletedRows);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

}
