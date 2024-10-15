import express,{Router as router} from 'express';
import {default as bodyParser} from 'body-parser';
import {default as passport} from 'passport';
import {ruleEnd} from '#routes/constants.js';
import {default as ruleCrtlr} from "#rtControllers/rule.controller.js";
import authService from "#rtServices/auth.services.mjs";

class RuleRoutes {

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
       
       this.#Controller= new ruleCrtlr;
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

        this.Router.post(ruleEnd.post.create, passport.authenticate('JStrat', {session: false}), this.#Controller.create);

// Read

        this.Router.get(ruleEnd.get.list, passport.authenticate('JStrat', {session: false}), this.#Controller.getList);

        this.Router.get(ruleEnd.get.rule, passport.authenticate('JStrat', {session: false}), this.#Controller.getRule);

// Update

        this.Router.put(ruleEnd.put.update, passport.authenticate('JStrat', {session: false}), this.#Controller.update);

// Delete

        this.Router.delete(ruleEnd.delete.remove, passport.authenticate('JStrat', {session: false}), this.#Controller.remove);
    }
}


export default RuleRoutes;