const endpoints = {
    user: {
        get: {
            getAllUsers: '/users/:role?/:full?',
            getUser: '/user/:id?/:email?/:username?/:full?',
            getProtectedUser: '/protected',
        },
        post: {
            registerUser: '/user',
            loginUser: '/login',
        },
        put: {
            updateUser: '/user',
        },
        delete: {
            deleteUser: '/user',
        },

    },
};

const userEnd = endpoints.user;



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
            getAllUsers: {
                success: {
                    condition: {
                        par: null
                    }
                },
                error: {
                    condition: {
                        par: "Error retrieving user list.",
                        role: "Error getting users by role.",
                        all: "Error retrieving user list."
                    }
                }
            },
            getUser: {
                success: {
                    condition: {
                        par: null
                    }
                },
                error: {
                    condition: {
                        par: "Error: No such user ID.",
                        no_sub: "No ID, username, or email provided.",
                        id: "Error getting user by ID.",
                        mail: "Error getting user by email.",
                        name: "Error getting user by username."
                    }
                }
            },
            getProtetedUser: {
                success: {condition: {par: null}},
                error: {condition: {par: null}}
            }
        },
        post: {
            register: {
                success: {condition: {par: "User successfully created."}},
                error: {condition: {par: "Error registering user."}}
            },
            login: {
                success: {condition: {par: null}},
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

module.exports = {endpoints: endpoints, userEnd: userEnd, messages:messages, userMsg:userMsg, monster:monster};