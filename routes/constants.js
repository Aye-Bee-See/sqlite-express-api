const endpoints = {
    user: {
        get: {
            many: '/users{/:role}{/:full}',
            one: '/user{/:id}{/:email}{/:username}{/:full}',
            protect: '/protected'
        },
        post: {
            create: '/user',
            login: '/login',
            uploadAvi: '/uploadAvi'
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
            many: '/rules{/:prison}{/:full}',
            one: '/rule{/:id}'
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
            many: '/prisoners{/:prison}{/:full}',
            one: '/prisoner{/:id}'
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
    },
    prison: {
        get: {
            many: '/prisons{/:full}',
            one: '/prison{/:id}'
        },
        post: {
            create: '/prison'
        },
        put: {
            update: '/prison',
            rule: '/rule'
        },
        delete: {
            remove: '/prison'
        }
    },
    chapter: {
        get: {
            many: '/chapters',
            one: '/chapter{/:id}'    
        },
        post: {
            create: '/chapter'
        },
        put: {
            update: '/chapter'
        },
        delete: {
            remove: '/chapter'
        }
    },
    message: {
        get: {
            many: '/messages{/:id}{/:chat}{/:prisoner}{/:user}',
            one: '/message{/:id}'
        },
        post: {
            create: '/message'
        },
        put: {
            update: '/message'
        },
        delete: {
            remove: '/message'
        }
    },
    chat: {
        get: {
            many: '/chats{/:prisoner}{/:user}{/:full}',
            one: '/chat{/:id}{/:prisoner}{/:user}{/:full}'
        },
        post: {
            create: '/chat'
        },
        put: {
            update: '/chat'
        },
        delete: {
            remove: '/chat'
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
                408: "Request timeout",
                500: "Internal Server Error",
                501: "Not Implemented",
                502: "Bad Gateway",
                503: "Service Unavailable",
                504: "Gateway Timeout",
                505: "HTTP Version Not Supported",
                506: "Variant Also Negotiates",
                507: "Insufficient Storage (WebDAV)",
                508: "Loop Detected (WebDAV)",
                510: "Not Extended",
                511: "Network Authentication Required"
            }
        }
    },
    user: {
        get: {
            many: {
                success: {
                    condition: {
                        par: null
                    }
                },
                error: {
                    condition: {
                        par: "Error retrieving user list.",
                        role: "Error getting users by role."
                    }
                }
            },
            one: {
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
            create: {
                success: {condition: {par: "Successfully created user."}},
                error: {condition: {par: "Error registering user."}}
            },
            login: {
                success: {condition: {par: "Login success."}},
                error: {condition: {par: 'No such user or associated password found.'}}
            },
            uploadAvi: {
                success: {condition: {par: "Successfully uploaded avatar"}},
                error: {condition: {par: "Unable to successfully upload avatar"}}
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
            many: {
                success: {condition: {par: "Successfully retireved rule list"}},
                error: {condition: {
                        par: "Error getting rules list",
                        prison: "Error getting rules by prison"
                    }
                }
            },
            one: {
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
            many: {
                success: {condition: {par: "Successfully retireved prisoners list"}},
                error: {condition: {
                        par: "Error getting prisoners list",
                        prison: "Error getting prisoners by prison"
                    }
                }
            },
            one: {
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
    },
    prison: {
        get: {
            many: {
                success: {condition: {par: "Successfully retireved prisons list"}},
                error: {condition: {
                        par: "Error getting prisons list"
                    }
                }
            },
            one: {
                success: {condition: {par: "Success getting prison by ID"}},
                error: {condition: {par: "Error getting prison by ID"}}
            }
        },
        post: {
            create: {
                success: {condition: {par: "Successfully created prison"}},
                error: {condition: {par: "Error creating prison"}}
            }
        },
        put: {
            update: {
                success: {condition: {par: "Succeessfully updated prison"}},
                error: {condition: {par: "Error updating prison."}}
            },
            rule: {
                success: {condition: {par: "Succeessfully added rule prison"}},
                error: {condition: {par: "Error adding rule to prison."}}
            }
        },
        delete: {
            remove: {
                success: {condition: {par: "Succeessfully deleted prison"}},
                error: {condition: {
                        par: "Error deleting prison",
                        absent: "No such prison"
                    }
                }
            }
        }
    },
    message: {
        get: {
            many: {
                success: {condition: {par: "Successfully retireved message list"}},
                error: {condition: {
                        par: "Error getting message list"
                    }
                }
            },
            one: {
                success: {condition: {par: "Success getting message by ID"}},
                error: {condition: {par: "Error getting message by ID"}}
            }
        },
        post: {
            create: {
                success: {condition: {par: "Successfully created message"}},
                error: {condition: {par: "Error creating message"}}
            }
        },
        put: {
            update: {
                success: {condition: {par: "Succeessfully updated message"}},
                error: {condition: {par: "Error updating message."}}
            }
        },
        delete: {
            remove: {
                success: {condition: {par: "Succeessfully deleted message"}},
                error: {condition: {
                        par: "Error deleting message",
                        absent: "No such message"
                    }
                }
            }
        }
    },
    chat: {
        get: {
            many: {
                success: {condition: {par: "Successfully retireved chats list"}},
                error: {condition: {
                        par: "Error getting chats list"
                    }
                }
            },
            one: {
                success: {condition: {par: "Success getting chat"}},
                error: {condition: {
                        par: "Error getting chat",
                        param: "Error getting chat:  Required paramater missing. You must provide BOTH {user} and {prisoner}",
                        empty: "Error getting chat:  Required paramaters missing.   You must provide either {id} or both {user} and {prisoner}"
                    }}
            }
        },
        post: {
            create: {
                success: {condition: {par: "Successfully created chat"}},
                error: {condition: {par: "Error creating chat"}}
            }
        },
        put: {
            update: {
                success: {condition: {par: "Succeessfully updated chat"}},
                error: {condition: {par: "Error updating chat."}}
            }
        },
        delete: {
            remove: {
                success: {condition: {par: "Succeessfully deleted chat"}},
                error: {condition: {
                        par: "Error deleting chat",
                        absent: "No such chat"
                    }
                }
            }
        }
    },
    chapter: {
        get: {
            many: {
                success: {condition: {par: "Successfully retireved chapter list"}},
                error: {condition: {
                        par: "Error getting chapter list"
                    }
                }
            },
            one: {
                success: {condition: {par: "Success getting chapter"}},
                error: {condition: {
                        par: "Error getting chapter",
                        empty: "Error getting chapter:  Required paramaters missing.   You must provide {id}"
                    }}
            }
        },
        post: {
            create: {
                success: {condition: {par: "Successfully created chapter"}},
                error: {condition: {par: "Error creating chapter"}}
            }
        },
        put: {
            update: {
                success: {condition: {par: "Succeessfully updated chapter"}},
                error: {condition: {par: "Error updating chapter."}}
            }
        },
        delete: {
            remove: {
                success: {condition: {par: "Succeessfully deleted chapter"}},
                error: {condition: {
                        par: "Error deleting chapter",
                        absent: "No such chapter"
                    }
                }
            }
        }
    }
};

/**
 * Just everything
 */
const monster = {...endpoints, ...messages};

export {endpoints, messages, monster};

/***********End Points***********/

export const {
    user: userMsg,
    rule: ruleMsg,
    prisoner: prisonerMsg,
    prison: prisonMsg,
    message: messageMsg,
    chat: chatMsg,
    chapter: chapterMsg
} = messages;

/***********Messages***********/

export const {
    user: userEnd,
    rule: ruleEnd,
    prisoner: prisonerEnd,
    prison: prisonEnd,
    message: messageEnd,
    chat: chatEnd,
    chapter: chapterEnd,
} = endpoints;
