import express,{Router as router} from 'express';
import {default as bodyParser} from 'body-parser';
import {default as passport} from 'passport';
import {prisonerEnd} from '#routes/constants.js';
import {default as prisonerCrtlr} from "#rtControllers/prisoner.controller.js";
import authService from "#rtServices/auth.services.mjs";

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
       const app=express();
       app.use(bodyParser.json());
       app.use(bodyParser.urlencoded({extended: true}));
       app.use(passport.initialize());
       
       const JwtStrat = authService.authorize;
       passport.use('UsrJStrat', JwtStrat);
       
       this.#Controller= new prisonerCrtlr;
       this.Router = express.Router();
       

       this.#router();
   }
    /***
     * 
     *   Handle router params
     * 
     ***/
    static #router(){

// Create

        this.Router.post(prisonerEnd.post.create, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.create);

// Read

        this.Router.get(prisonerEnd.get.many, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.getMany);

        this.Router.get(prisonerEnd.get.one, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.getOne);

        // Get Prisoner Avatar
        this.Router.get(prisonerEnd.get.avatar, this.#Controller.getAvatar);

// Update

        this.Router.put(prisonerEnd.put.update, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.update);

// Delete

                    this.Router.delete(prisonerEnd.delete.remove, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.remove);
    }
}


export default PrisonerRoutes;
