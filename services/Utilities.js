
/**
 * Generic js utilities
 */
export default class Utilities {
    /**
     * A more firm check for undefined values
     * 
     */
    static isUndefined(varToTest) {
        const isError = typeof (varToTest === undefined) === Error;

        return isError || typeof varToTest === 'undefined' || varToTest === undefined;
    }
    
    /**
     * Resolve an array of promises sequentially 
     * @param Array promiseArray an array of promises to be resolved
     * @param Array dataArray captures return data from each promise and is returned
     * at the end of the execution.
     * @return Array an array of values returned from each promise 
     */
    static async resolveSequential(promiseArray, dataArray = []) {
        return new Promise((resolve, reject) => {
            let count = dataArray.count || 0;
            if (Array.isArray(promiseArray) && promiseArray.length) {
                const currentPromise = promiseArray.shift();
                try {
                    currentPromise().then((data) => {
                        dataArray[count] = data;
                        count++;
                        dataArray.count = count;

                        resolve(Utilities.resolveSequential(promiseArray, dataArray));
                    });
                } catch (err) {
                    console.error(err.message)
                    reject(err);
                }

            } else {
                resolve(dataArray);
            }
        });
    }
}
