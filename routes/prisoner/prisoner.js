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
       passport.use('JStrat', JwtStrat);
       
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

        this.Router.post(prisonerEnd.post.create, this.#Controller.create);

// Read

        this.Router.get(prisonerEnd.get.many, this.#Controller.getMany);

        this.Router.get(prisonerEnd.get.one, this.#Controller.getOne);

// Update

        this.Router.put(prisonerEnd.put.update, this.#Controller.update);

// Delete

        this.Router.delete(prisonerEnd.delete.remove, this.#Controller.remove);
    }
}


export default PrisonerRoutes;
