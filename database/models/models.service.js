import Chat from '#models/chat.model.mjs';
import Message from '#models/message.model.mjs';
import Prison from '#models/prison.model.mjs';
import Prisoner from '#models/prisoner.model.mjs';
import Rule from '#models/rule.model.mjs';
import User from '#models/user.model.mjs';



export default class modelsService {
        
        /**
         * Checks if an instance of a model exists (using modelX.findByPk(primaryKeyValue)
         * handles error output
         * @param   {string} modelName (e.g. Chat, Message, Prison, ...)
         *  @param {mixed} primaryKeyValue The value of the primary key for a given model instance.  Generally {id} in which case the integer/uuid value of the specific instance. 
         */
        static async modelInstanceExists(modelName, primaryKeyValue){
            let model;
            let errMsg;
            errMsg=modelName +" " + primaryKeyValue + " not found";
            switch(modelName){
                case 'Chat':
                    model=Chat;
                    break;
                case 'Message':
                    model=Message;
                    break;
                case 'Prison':
                    model=Prison;
                    break;
                case 'Prisoner':
                    model=Prisoner;
                    break;
                case 'Rule':
                    model=Rule;
                    break;
                case 'User':
                    model=User;
                    break;
                default:
                    errMsg="Unknown modelName"
                    break;
            }
            
            const instanceExists= await model.findByPk(primaryKeyValue);
            //console.log(instanceExists);
            if(!instanceExists){
                  return new Error(errMsg);
            }
            return instanceExists;
            
            
        }
}

