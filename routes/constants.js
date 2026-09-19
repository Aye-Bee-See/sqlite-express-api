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
			logout: '/logout',
			revoke: '/revoke',
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
	keys: {
		get: {
			one: '/keys',
			many: '/member-keys',
			publicKey: '/public-key',
			recoverChallenge: '/recover',
			rotationMaterial: '/chapter-rotation',
			readiness: '/encryption-readiness'
		},
		post: {
			create: '/recover',
			rotate: '/chapter-rotation'
		},
		put: {
			update: '/keys',
			chapterKeys: '/chapter-keys',
			putMemberKey: '/member-key'
		},
		delete: {
			remove: '/member-key'
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
			one: '/prison',
			mailRules: '/mail-rules'
		},
		post: {
			create: '/prison',
			createMailRule: '/mail-rule'
		},
		put: {
			update: '/prison',
			addRelay: '/relay',
			updateMailRule: '/mail-rule'
		},
		delete: {
			remove: '/prison',
			removeRelay: '/relay',
			removeMailRule: '/mail-rule'
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
	invitation: {
		get: {
			many: '/invitations',
			one: '/invitation'
		},
		post: {
			create: '/invitation',
			accept: '/accept'
		},
		put: {
			update: '/invitation'
		},
		delete: {
			remove: '/invitation'
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
			one: '/message',
			retention: '/retention',
			missingEnvelopes: '/envelopes/missing'
		},
		post: {
			create: '/message',
			createEnvelope: '/envelope'
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
			logout: {
				success: {
					condition: {
						par: 'Signed out. This token no longer works.',
						everywhere: 'Signed out everywhere. Every token for this account no longer works.'
					}
				},
				error: { condition: { par: 'Error signing out.' } }
			},
			revoke: {
				success: { condition: { par: 'Every token for this account no longer works.' } },
				error: { condition: { par: 'Error revoking sessions.' } }
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
			},
			mailRules: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error reading the mail rule vocabulary.' } }
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Successfully created prison' } },
				error: { condition: { par: 'Error creating prison' } }
			},
			createMailRule: {
				success: { condition: { par: 'Rule added to the master list.' } },
				error: { condition: { par: 'Error adding the rule.' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Succeessfully updated prison' } },
				error: { condition: { par: 'Error updating prison.' } }
			},
			addRelay: {
				success: { condition: { par: 'Successfully added relay group to prison' } },
				error: { condition: { par: 'Error adding relay group to prison.' } }
			},
			updateMailRule: {
				success: { condition: { par: 'Rule updated.' } },
				error: { condition: { par: 'Error updating the rule.' } }
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
			removeRelay: {
				success: { condition: { par: 'Successfully removed relay group from prison' } },
				error: { condition: { par: 'Error removing relay group from prison.' } }
			},
			removeMailRule: {
				success: { condition: { par: 'Rule removed from the master list.' } },
				error: { condition: { par: 'Error removing the rule.' } }
			}
		}
	},
	keys: {
		get: {
			one: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error reading keys.' } }
			},
			many: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error listing member keys.' } }
			},
			publicKey: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error reading public key.' } }
			},
			recoverChallenge: {
				success: { condition: { par: 'Open the challenge with your recovered private key.' } },
				error: { condition: { par: 'Error starting recovery.' } }
			},
			rotationMaterial: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error reading rotation material.' } }
			},
			readiness: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error reading encryption readiness.' } }
			}
		},
		post: {
			create: {
				success: { condition: { par: 'Password reset. You can now sign in.' } },
				error: { condition: { par: 'Error finishing recovery.' } }
			},
			rotate: {
				success: { condition: { par: 'Group key rotated.' } },
				error: { condition: { par: 'Error rotating the group key.' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Keys saved.' } },
				error: { condition: { par: 'Error saving keys.' } }
			},
			chapterKeys: {
				success: { condition: { par: 'Group keys set.' } },
				error: { condition: { par: 'Error setting group keys.' } }
			},
			putMemberKey: {
				success: { condition: { par: 'Member key saved.' } },
				error: { condition: { par: 'Error saving member key.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Member key removed.' } },
				error: { condition: { par: 'Error removing member key.' } }
			}
		}
	},
	invitation: {
		get: {
			many: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error listing invitations.' } }
			},
			one: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error checking the invitation.' } }
			}
		},
		post: {
			create: {
				success: {
					condition: { par: 'Invitation created. The token is shown once; hand it over yourself.' }
				},
				error: { condition: { par: 'Error creating the invitation.' } }
			},
			accept: {
				success: { condition: { par: 'Invitation accepted. You can now sign in.' } },
				error: { condition: { par: 'Error accepting the invitation.' } }
			}
		},
		put: {
			update: {
				success: { condition: { par: 'Invitation renewed. The old token no longer works.' } },
				error: { condition: { par: 'Error renewing the invitation.' } }
			}
		},
		delete: {
			remove: {
				success: { condition: { par: 'Invitation withdrawn.' } },
				error: { condition: { par: 'Error withdrawing the invitation.' } }
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
			},
			retention: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error reading retention settings.' } }
			},
			missingEnvelopes: {
				success: { condition: { par: null } },
				error: { condition: { par: 'Error listing missing envelopes.' } }
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
			},
			createEnvelope: {
				success: { condition: { par: 'Reader added.' } },
				error: { condition: { par: 'Error adding reader.' } }
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
	prisoner: prisonerMsg,
	prison: prisonMsg,
	message: messageMsg,
	chat: chatMsg,
	chapter: chapterMsg,
	moderation: moderationMsg,
	invitation: invitationMsg,
	keys: keysMsg
} = messages;

/***********Messages***********/

export const {
	user: userEnd,
	prisoner: prisonerEnd,
	prison: prisonEnd,
	message: messageEnd,
	chat: chatEnd,
	chapter: chapterEnd,
	moderation: moderationEnd,
	invitation: invitationEnd,
	keys: keysEnd
} = endpoints;
