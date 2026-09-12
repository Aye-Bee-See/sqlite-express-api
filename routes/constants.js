const endpoints = {
	user: {
		get: {
			many: '/users',
			one: '/user',
			writers: '/writers',
			claimInfo: '/claim'
		},
		post: {
			create: '/user',
			login: '/login',
			createWriter: '/writer',
			createToken: '/writer/token',
			claim: '/claim'
		},
		put: {
			update: '/user'
		},
		delete: {
			remove: '/user',
			revokeToken: '/writer/token'
		}
	},
	rule: {
		get: {
			many: '/rules',
			one: '/rule'
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
			many: '/prisoners',
			one: '/prisoner'
		},
		post: {
			create: '/prisoner'
		},
		put: {
			update: '/prisoner',
			addSupport: '/support'
		},
		delete: {
			remove: '/prisoner',
			removeSupport: '/support'
		}
	},
	prison: {
		get: {
			many: '/prisons',
			one: '/prison'
		},
		post: {
			create: '/prison'
		},
		put: {
			update: '/prison',
			addRule: '/rule',
			addRelay: '/relay'
		},
		delete: {
			remove: '/prison',
			removeRule: '/rule',
			removeRelay: '/relay'
		}
	},
	chapter: {
		get: {
			many: '/chapters',
			one: '/chapter'
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
	moderation: {
		get: {
			many: '/submissions',
			one: '/submission',
			audit: '/audit',
			summary: '/summary'
		},
		post: {
			create: '/submission'
		},
		put: {
			update: '/submission',
			approve: '/approve',
			reject: '/reject'
		},
		delete: {
			remove: '/submission'
		}
	},
	message: {
		get: {
			many: '/messages',
			one: '/message'
		},
		post: {
			create: '/message'
		},
		put: {
			update: '/message',
			updateStatus: '/status'
		},
		attachment: {
			create: '/attachment',
			many: '/attachments',
			one: '/attachment',
			remove: '/attachment'
		},
		delete: {
			remove: '/message'
		}
	},
	chat: {
		get: {
			many: '/chats',
			one: '/chat'
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
				400: 'Something went wrong',
				401: 'Unauthorized',
				403: 'Forbidden',
				404: 'Not found',
				405: 'Method not allowed',
				408: 'Request timeout',
				500: 'Internal Server Error',
				501: 'Not Implemented',
				502: 'Bad Gateway',
				503: 'Service Unavailable',
				504: 'Gateway Timeout',
				505: 'HTTP Version Not Supported',
				506: 'Variant Also Negotiates',
				507: 'Insufficient Storage (WebDAV)',
				508: 'Loop Detected (WebDAV)',
				510: 'Not Extended',
				511: 'Network Authentication Required'
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
						par: 'Error retrieving user list.',
						role: 'Error getting users by role.'
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
						par: 'Error: No such user ID.',
						empty: 'No ID, username, or email provided.',
						id: 'Error getting user by ID.',
						mail: 'Error getting user by email.',
						name: 'Error getting user by username.'
					}
				}
			},
			writers: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error listing managed writers.' } }
			},
			claimInfo: {
				success: { condition: { par: 'Claim token is valid.' } },
				error: {
					condition: {
						par: 'Error checking claim token.',
						unknown: 'This claim token is not valid.',
						used: 'This claim token has already been used.',
						expired: 'This claim token has expired. Ask your group for a new one.'
					}
				}
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Successfully created user.' } },
				error: { condition: { par: 'Error registering user.' } }
			},
			login: {
				success: { condition: { par: 'Login success.' } },
				error: { condition: { par: 'No such user or associated password found.' } }
			},
			createWriter: {
				success: { condition: { par: 'Successfully created managed writer.' } },
				error: { condition: { par: 'Error creating managed writer.' } }
			},
			createToken: {
				success: { condition: { par: 'Claim token generated. Show it to the writer once.' } },
				error: { condition: { par: 'Error generating claim token.' } }
			},
			claim: {
				success: { condition: { par: 'Account claimed. You can now sign in.' } },
				error: {
					condition: {
						par: 'Error claiming account.',
						unknown: 'This claim token is not valid.',
						used: 'This claim token has already been used.',
						expired: 'This claim token has expired. Ask your group for a new one.'
					}
				}
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Successfully updated user.' } },
				error: { condition: { par: 'Error updating user.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Successfully deleted user.' } },
				error: {
					condition: {
						par: 'Error deleting user',
						absent: 'No such user'
					}
				}
			},
			revokeToken: {
				success: { condition: { par: 'Claim token revoked.' } },
				error: { condition: { par: 'Error revoking claim token.' } }
			}
		}
	},
	rule: {
		get: {
			many: {
				success: { condition: { par: 'Successfully retireved rule list' } },
				error: {
					condition: {
						par: 'Error getting rules list',
						prison: 'Error getting rules by prison'
					}
				}
			},
			one: {
				success: { condition: { par: 'Success getting rule by ID' } },
				error: { condition: { par: 'Error getting rule by ID' } }
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Successfully created rule' } },
				error: { condition: { par: 'Error creating rule' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Succeessfully updated rule' } },
				error: { condition: { par: 'Error updating rule.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Succeessfully deleted rule' } },
				error: {
					condition: {
						par: 'Error deleting rule',
						absent: 'No such rule'
					}
				}
			}
		}
	},
	prisoner: {
		get: {
			many: {
				success: { condition: { par: 'Successfully retireved prisoners list' } },
				error: {
					condition: {
						par: 'Error getting prisoners list',
						prison: 'Error getting prisoners by prison'
					}
				}
			},
			one: {
				success: { condition: { par: 'Success getting prisoner by ID' } },
				error: { condition: { par: 'Error getting prisoner by ID' } }
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Successfully created prisoner' } },
				error: { condition: { par: 'Error creating prisoner' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Succeessfully updated prisoner' } },
				error: { condition: { par: 'Error updating prisoner.' } }
			},
			addSupport: {
				success: { condition: { par: 'Successfully added support group to prisoner' } },
				error: { condition: { par: 'Error adding support group to prisoner.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Succeessfully deleted prisoner' } },
				error: {
					condition: {
						par: 'Error deleting prisoner',
						absent: 'No such prisoner'
					}
				}
			},
			removeSupport: {
				success: { condition: { par: 'Successfully removed support group from prisoner' } },
				error: { condition: { par: 'Error removing support group from prisoner.' } }
			}
		}
	},
	prison: {
		get: {
			many: {
				success: { condition: { par: 'Successfully retireved prisons list' } },
				error: {
					condition: {
						par: 'Error getting prisons list'
					}
				}
			},
			one: {
				success: { condition: { par: 'Success getting prison by ID' } },
				error: { condition: { par: 'Error getting prison by ID' } }
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Successfully created prison' } },
				error: { condition: { par: 'Error creating prison' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Succeessfully updated prison' } },
				error: { condition: { par: 'Error updating prison.' } }
			},
			addRule: {
				success: { condition: { par: 'Successfully added rule to prison' } },
				error: { condition: { par: 'Error adding rule to prison.' } }
			},
			addRelay: {
				success: { condition: { par: 'Successfully added relay group to prison' } },
				error: { condition: { par: 'Error adding relay group to prison.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Succeessfully deleted prison' } },
				error: {
					condition: {
						par: 'Error deleting prison',
						absent: 'No such prison'
					}
				}
			},
			removeRule: {
				success: { condition: { par: 'Successfully removed rule from prison' } },
				error: { condition: { par: 'Error removing rule from prison.' } }
			},
			removeRelay: {
				success: { condition: { par: 'Successfully removed relay group from prison' } },
				error: { condition: { par: 'Error removing relay group from prison.' } }
			}
		}
	},
	moderation: {
		get: {
			many: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error listing submissions.' } }
			},
			one: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error reading submission.' } }
			},
			audit: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error reading the audit log.' } }
			},
			summary: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error building the moderation summary.' } }
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Thanks. Your proposal is waiting for review.' } },
				error: { condition: { par: 'Error filing the proposal.' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Proposal updated.' } },
				error: { condition: { par: 'Error updating the proposal.' } }
			},
			approve: {
				success: { condition: { par: 'Approved and applied.' } },
				error: { condition: { par: 'Error approving the submission.' } }
			},
			reject: {
				success: { condition: { par: 'Rejected.' } },
				error: { condition: { par: 'Error rejecting the submission.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Proposal withdrawn.' } },
				error: { condition: { par: 'Error withdrawing the proposal.' } }
			}
		}
	},
	message: {
		get: {
			many: {
				success: { condition: { par: 'Successfully retireved message list' } },
				error: {
					condition: {
						par: 'Error getting message list'
					}
				}
			},
			one: {
				success: { condition: { par: 'Success getting message by ID' } },
				error: { condition: { par: 'Error getting message by ID' } }
			},
			attachments: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error listing attachments.' } }
			},
			getAttachment: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error reading attachment.' } }
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Successfully created message' } },
				error: { condition: { par: 'Error creating message' } }
			},
			createAttachment: {
				success: { condition: { par: 'Attachment uploaded.' } },
				error: { condition: { par: 'Error uploading attachment.' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Succeessfully updated message' } },
				error: { condition: { par: 'Error updating message.' } }
			},
			updateStatus: {
				success: { condition: { par: 'Letter status updated.' } },
				error: { condition: { par: 'Error updating letter status.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Succeessfully deleted message' } },
				error: {
					condition: {
						par: 'Error deleting message',
						absent: 'No such message'
					}
				}
			},
			removeAttachment: {
				success: { condition: { par: 'Attachment deleted.' } },
				error: { condition: { par: 'Error deleting attachment.' } }
			}
		}
	},
	chat: {
		get: {
			many: {
				success: { condition: { par: 'Successfully retireved chats list' } },
				error: {
					condition: {
						par: 'Error getting chats list'
					}
				}
			},
			one: {
				success: { condition: { par: 'Success getting chat' } },
				error: {
					condition: {
						par: 'Error getting chat',
						param:
							'Error getting chat:  Required paramater missing. You must provide BOTH {user} and {prisoner}',
						empty:
							'Error getting chat:  Required paramaters missing.   You must provide either {id} or both {user} and {prisoner}'
					}
				}
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Successfully created chat' } },
				error: { condition: { par: 'Error creating chat' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Succeessfully updated chat' } },
				error: { condition: { par: 'Error updating chat.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Succeessfully deleted chat' } },
				error: {
					condition: {
						par: 'Error deleting chat',
						absent: 'No such chat'
					}
				}
			}
		}
	},
	chapter: {
		get: {
			many: {
				success: { condition: { par: 'Successfully retireved chapter list' } },
				error: {
					condition: {
						par: 'Error getting chapter list'
					}
				}
			},
			one: {
				success: { condition: { par: 'Success getting chapter' } },
				error: {
					condition: {
						par: 'Error getting chapter',
						empty: 'Error getting chapter:  Required paramaters missing.   You must provide {id}'
					}
				}
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Successfully created chapter' } },
				error: { condition: { par: 'Error creating chapter' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Succeessfully updated chapter' } },
				error: { condition: { par: 'Error updating chapter.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Succeessfully deleted chapter' } },
				error: {
					condition: {
						par: 'Error deleting chapter',
						absent: 'No such chapter'
					}
				}
			}
		}
	}
};

/**
 * Just everything
 */
const monster = { ...endpoints, ...messages };

export { endpoints, messages, monster };

/***********End Points***********/

export const {
	user: userMsg,
	rule: ruleMsg,
	prisoner: prisonerMsg,
	prison: prisonMsg,
	message: messageMsg,
	chat: chatMsg,
	chapter: chapterMsg,
	moderation: moderationMsg
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
	moderation: moderationEnd
} = endpoints;
