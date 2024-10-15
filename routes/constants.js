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
            remove: '/user'
        }

    },
    rule: {
        get: {
            list: '/rules/:prison?/:full?',
            rule: '/rule/:id?'
        },
        post: {
            create: '/rule'
        },
        put: {
            update: '/rule'
        },
        delete: {
            remove: '/rule'
        }
    },
    prisoner: {
        get: {
            list: '/prisoners/:prison?/:full?',
            prisoner: '/prisoner/:id?'
        },
        post: {
            create: '/prisoner'
        },
        put: {
            update: '/prisoner'
        },
        delete: {
            remove: '/prisoner'
        }
    }
};




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
                success: {condition: {par: "Successfully created user."}},
                error: {condition: {par: "Error registering user."}}
            },
            login: {
                success: {condition: {par: "Login success."}},
                error: {condition: {par: 'No such user or associated password found.'}}
            }
        },
        put: {
            update: {
                success: {condition: {par: "Successfully updated user."}},
                error: {condition: {par: "Error updating user."}}
            }
        },
        delete: {
            remove: {
                success: {condition: {par: "Successfully deleted user."}},
                error: {condition: {
                        par: "Error deleting user",
                        absent: "No such user"
                    }
                }
            }
        }
    },
    rule: {
        get: {
            list: {
                success: {condition: {par: "Successfully retireved rule list"}},
                error: {condition: {
                        par: "Error getting rules list",
                        prison: "Error getting rules by prison"
                    }
                }
            },
            rule: {
                success: {condition: {par: "Success getting rule by ID"}},
                error: {condition: {par: "Error getting rule by ID"}}
            }
        },
        post: {
            create: {
                success: {condition: {par: "Successfully created rule"}},
                error: {condition: {par: "Error creating rule"}}
            }
        },
        put: {
            update: {
                success: {condition: {par: "Succeessfully updated rule"}},
                error: {condition: {par: "Error updating rule."}}
            }
        },
        delete: {
            remove: {
                success: {condition: {par: "Succeessfully deleted rule"}},
                error: {condition: {
                        par: "Error deleting rule",
                        absent: "No such rule"
                    }
                }
            }
        }
    },
        prisoner: {
        get: {
            list: {
                success: {condition: {par: "Successfully retireved prisoners list"}},
                error: {condition: {
                        par: "Error getting prisoners list",
                        prison: "Error getting prisoners by prison"
                    }
                }
            },
            prisoner: {
                success: {condition: {par: "Success getting prisoner by ID"}},
                error: {condition: {par: "Error getting prisoner by ID"}}
            }
        },
        post: {
            create: {
                success: {condition: {par: "Successfully created prisoner"}},
                error: {condition: {par: "Error creating prisoner"}}
            }
        },
        put: {
            update: {
                success: {condition: {par: "Succeessfully updated prisoner"}},
                error: {condition: {par: "Error updating prisoner."}}
            }
        },
        delete: {
            remove: {
                success: {condition: {par: "Succeessfully deleted prisoner"}},
                error: {condition: {
                        par: "Error deleting prisoner",
                        absent: "No such prisoner"
                    }
                }
            }
        }
    }
};

/***********End Points***********/
const userEnd = endpoints.user;
const ruleEnd = endpoints.rule;
const prisonerEnd = endpoints.prisoner;

/***********Messages***********/
const userMsg = messages.user;
const ruleMsg = messages.rule;
const prisonerMsg = messages.prisoner;

/**
 * Just everything
 */
const monster = {...endpoints, ...messages};

export {endpoints, userEnd, ruleEnd, prisonerEnd, messages, userMsg, ruleMsg, prisonerMsg, monster};
