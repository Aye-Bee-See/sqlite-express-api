const endpoints = {
    user: {
        get: {
            list: '/users/:role?/:full?',
            user: '/user/:id?/:email?/:username?/:full?',
            protect: '/protected'
        },
        post: {
            register: '/user',
            login: '/login'
        },
        put: {
            update: '/user'
        },
        delete: {
            delete: '/user'
        }

    }
};

const userEnd = endpoints.user;




    /***
     *         const errors = {
            nid: "Error: No such user ID.",
            nusr: "Zero users exist in the database.",
            id: "Error getting user by ID.",
            mail: "Error getting user by email.",
            name: "Error getting user by username.",
            up: "Error updating user.",
            del: "Error deleting user.",
            reg: "Err registering user.",
            list: "Error retrieving user list.",
            role: "Error getting users by role.",
            logn: 'No such user or associated password found.',
            niue: "No ID, username, or email provided.",
            empty: "Error retrieving user list."

        };
     */
    


/***************************************************************************
 **                               Note:                                   **
 **  Currently making placeholders for endpoints and/or conditions that   **
 **  wont have anything yet.  Both for the sake of possible iterating     **
 **  and so that it will be less work in the future should it be added.   **
 **                                                                       **
 **  It's worth noting that I'm not presently sure of the organization    **
 **  I've run through a few scenarios and this seems to function but it   **
 **  is absolutely cumbersome so perhaps a better solution exists already **
 ***************************************************************************/

const messages = {
    defaults: {
        literal: {
            http: {
                400: "Something went wrong",
                401: "Unauthorized",
                403: "Bad request",
                404: "Not found",
                405: "Method not allowed",
                408: "Request timeout"
            }
        }
    },
    user: {
        get: {
            list: {
                success: {
                    condition: {
                        par: null
                    }
                },
                error: {
                    condition: {
                        par: "Error retrieving user list.",
                        role: "Error getting users by role.",
                    }
                }
            },
            user: {
                success: {
                    condition: {
                        par: null
                    }
                },
                error: {
                    condition: {
                        par: "Error: No such user ID.",
                        empty: "No ID, username, or email provided.",
                        id: "Error getting user by ID.",
                        mail: "Error getting user by email.",
                        name: "Error getting user by username."
                    }
                }
            },
            protect: {
                success: {condition: {par: 'Congrats! You are seeing this because you are authorized.'}},
                error: {condition: {par: null}}
            }
        },
        post: {
            register: {
                success: {condition: {par: "User successfully created."}},
                error: {condition: {par: "Error registering user."}}
            },
            login: {
                success: {condition: {par: "Login success."}},
                error: {condition: {par: 'No such user or associated password found.'}}
            }
        },
        put: {
            update: {
                success: {condition: {par: "Updated user."}},
                error: {condition: {par: "Error updating user."}}
            }
        },
        delete: {
            remove: {
                success: {condition: {par:  "Deleted user."}},
                error: {condition: {par: "Error deleting user."}}
            }
        }
    }
};

const userMsg=messages.user;

/**
 * Just everything
 */
const monster = {...endpoints, ...messages};

export {endpoints as endpoints, userEnd as userEnd, messages as messages, userMsg as userMsg, monster as monster};