import express,{Router as router} from 'express';
import {default as bodyParser} from 'body-parser';
import {default as passport} from 'passport';
import {prisonEnd} from '#routes/constants.js';
import {default as prisonCrtlr} from "#rtControllers/prison.controller.js";
import authService from "#rtServices/auth.services.mjs";

class PrisonRoutes {

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
       
       this.#Controller= new prisonCrtlr;
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

        this.Router.post(prisonEnd.post.create, this.#Controller.create);

// Read

        this.Router.get(prisonEnd.get.list, this.#Controller.getList);

        this.Router.get(prisonEnd.get.prison, this.#Controller.getPrison);

// Update

        this.Router.put(prisonEnd.put.update, this.#Controller.update);
        // Add Rule
        this.Router.put(prisonEnd.put.rule, this.#Controller.addRule);

// Delete

        this.Router.delete(prisonEnd.delete.remove, this.#Controller.remove);
    }
}


export default PrisonRoutes;
