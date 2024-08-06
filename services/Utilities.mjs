export default class Utilities{
        static isUndefined(varToTest){
            const isError = typeof (varToTest===undefined) === Error;
            
            return isError || typeof varToTest==='undefined' || varToTest===undefined; 
        }
}
