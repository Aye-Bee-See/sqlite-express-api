import request from 'supertest';
import { expect } from 'chai';
import app from '../index.js';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the current file's path from its URL
const __filename = fileURLToPath(import.meta.url);
// Get the directory name from the file path
const __dirname = dirname(__filename);

// Define the path for the test databases
const CHAT_TEST_DB_PATH = path.join(__dirname, 'chat_test.db');
const USER_DB_PATH = path.join(__dirname, 'chat_user_test.db'); // For user authentication
const PRISONER_DB_PATH = path.join(__dirname, 'chat_prisoner_test.db'); // For prisoner references

describe('Chats API', function () {
	let server;
	let chatDb;
	let createdChatId;
	let authToken;
	let createdUserId;
	let createdPrisonerId;

	// Before all tests, set up the test databases and start the server
	before(function (done) {
		this.timeout(20000); // Increased timeout for multiple DB setups

		// Delete test databases if they exist
		[CHAT_TEST_DB_PATH, USER_DB_PATH, PRISONER_DB_PATH].forEach((dbPath) => {
			if (fs.existsSync(dbPath)) {
				fs.unlinkSync(dbPath);
			}
		});

		// 1. Connect to the user test database
		const userDb = new sqlite3.Database(USER_DB_PATH, (err) => {
			if (err) {
				console.error('Error opening user test database for chats:', err.message);
				return done(err);
			}
			console.log('Connected to the user test SQLite database for chats.');

			const createUserTableSql = `
                CREATE TABLE IF NOT EXISTS user (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    password TEXT NOT NULL,
                    email TEXT NOT NULL,
                    role TEXT NOT NULL
                );
            `;

			userDb.run(createUserTableSql, (err) => {
				if (err) {
					console.error('Error creating user table for chat tests:', err.message);
					return done(err);
				}
				console.log('User table created or already exists in user test database for chats.');

				// 2. Connect to the prisoner test database
				const prisonerDb = new sqlite3.Database(PRISONER_DB_PATH, (err) => {
					if (err) {
						console.error('Error opening prisoner test database for chats:', err.message);
						return done(err);
					}
					console.log('Connected to the prisoner test SQLite database for chats.');

					const createPrisonerTableSql = `
                        CREATE TABLE IF NOT EXISTS prisoner (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            firstName TEXT NOT NULL,
                            lastName TEXT NOT NULL,
                            prisonId INTEGER,
                            inmateId TEXT NOT NULL
                        );
                    `;

					prisonerDb.run(createPrisonerTableSql, (err) => {
						if (err) {
							console.error('Error creating prisoner table for chat tests:', err.message);
							return done(err);
						}
						console.log(
							'Prisoner table created or already exists in prisoner test database for chats.'
						);

						// 3. Connect to the chat test database
						chatDb = new sqlite3.Database(CHAT_TEST_DB_PATH, (err) => {
							if (err) {
								console.error('Error opening chat test database:', err.message);
								return done(err);
							}
							console.log('Connected to the chat test SQLite database.');

							const createChatTableSql = `
                                CREATE TABLE IF NOT EXISTS chat (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    user INTEGER NOT NULL,
                                    prisoner INTEGER NOT NULL
                                );
                            `;

							chatDb.run(createChatTableSql, (err) => {
								if (err) {
									console.error('Error creating chat table:', err.message);
									return done(err);
								}
								console.log('Chat table created or already exists in chat test database.');

								// Set the NODE_ENV to test
								process.env.NODE_ENV = 'test';
								process.env.TEST_CHAT_DB_PATH = CHAT_TEST_DB_PATH;
								process.env.TEST_USER_DB_PATH = USER_DB_PATH;
								process.env.TEST_PRISONER_DB_PATH = PRISONER_DB_PATH;

								// Start the server
								server = app.listen(4006, () => {
									console.log('Test server started on port 4006 for Chat API tests.');

									// Register a user for authentication
									request(app)
										.post('/auth/user')
										.send({
											username: 'testchatuser',
											name: 'Test Chat User',
											password: 'password123',
											email: 'chattest@example.com',
											role: 'admin'
										})
										.end((err, res) => {
											if (err) return done(err);

											// Make sure res.body.data exists and has id
											if (!res.body || !res.body.data || !res.body.data.id) {
												return done(
													new Error(
														'Failed to get user ID from response: ' + JSON.stringify(res.body)
													)
												);
											}

											createdUserId = res.body.data.id;

											// Login to get auth token first
											request(app)
												.post('/auth/login')
												.send({
													username: 'testchatuser',
													password: 'password123'
												})
												.end((err, res) => {
													if (err) return done(err);

													// Check if the response has the expected structure
													if (res.body && res.body.data && res.body.data.token) {
														authToken = res.body.data.token.token || res.body.data.token;
													} else {
														console.log('Auth response structure:', JSON.stringify(res.body));
														authToken = res.body.token || res.body.jwt || '';
													}

													if (!authToken) {
														return done(new Error('Failed to get auth token from response'));
													}

													// Create a test prisoner
													request(app)
														.post('/prisoner/prisoner')
														.set('Authorization', `Bearer ${authToken}`)
														.send({
															firstName: 'Test',
															lastName: 'Prisoner',
															inmateId: 'TP12345'
														})
														.end((err, res) => {
															if (err) return done(err);

															// Make sure res.body.data exists and has id
															if (!res.body || !res.body.data || !res.body.data.id) {
																return done(
																	new Error(
																		'Failed to get prisoner ID from response: ' +
																			JSON.stringify(res.body)
																	)
																);
															}

															createdPrisonerId = res.body.data.id;

															// Auth token already obtained
															done();
														});
												});
										});
								});
							});
						});
					});
				});
			});
		});
	});

	// After all tests, clean up
	after(function (done) {
		this.timeout(10000);

		// Close server and cleanup database files
		if (server) {
			server.close(() => {
				console.log('Test server for chats closed.');

				// Delete test database files
				[CHAT_TEST_DB_PATH, USER_DB_PATH, PRISONER_DB_PATH].forEach((dbPath) => {
					if (fs.existsSync(dbPath)) {
						fs.unlinkSync(dbPath);
						console.log(`${dbPath} deleted.`);
					}
				});

				done();
			});
		} else {
			done();
		}
	});

	// Test POST /chat/chat - Create a new chat
	describe('POST /chat/chat', function () {
		it('should create a new chat successfully', function (done) {
			request(app)
				.post('/chat/chat')
				.set('Authorization', `Bearer ${authToken}`)
				.send({
					user: createdUserId,
					prisoner: createdPrisonerId
				})
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(true);
					expect(res.body.data).to.have.property('id');
					createdChatId = res.body.data.id;
					// --- BEGIN ADDITION ---
					if (createdChatId !== undefined) {
						console.log(
							`[DEBUG] Chat created successfully. ID: ${createdChatId}, Full response data: ${JSON.stringify(res.body.data)}`
						);
					} else {
						console.error(
							`[DEBUG] ERROR: createdChatId is undefined after assignment. Response success: ${res.body.success}, Response data: ${JSON.stringify(res.body.data)}`
						);
					}
					// --- END ADDITION ---
					done();
				});
		});

		it('should return error if user is missing', function (done) {
			request(app)
				.post('/chat/chat')
				.set('Authorization', `Bearer ${authToken}`)
				.send({
					prisoner: createdPrisonerId
				})
				.expect(400)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(false);
					done();
				});
		});

		it('should return error if prisoner is missing', function (done) {
			request(app)
				.post('/chat/chat')
				.set('Authorization', `Bearer ${authToken}`)
				.send({
					user: createdUserId
				})
				.expect(400)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(false);
					done();
				});
		});
	});

	// Test GET /chat/chats - Get all chats
	describe('GET /chat/chats', function () {
		it('should return all chats', function (done) {
			request(app)
				.get('/chat/chats')
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(true);
					expect(Array.isArray(res.body.data)).to.be.true;
					expect(res.body.data.length).to.be.at.least(1);
					done();
				});
		});

		it('should filter chats by user', function (done) {
			request(app)
				.get(`/chat/chats?user=${createdUserId}`)
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(true);
					expect(Array.isArray(res.body.data)).to.be.true;
					res.body.data.forEach((chat) => {
						expect(chat.user).to.equal(createdUserId);
					});
					done();
				});
		});

		it('should filter chats by prisoner', function (done) {
			request(app)
				.get(`/chat/chats?prisoner=${createdPrisonerId}`)
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(true);
					expect(Array.isArray(res.body.data)).to.be.true;
					res.body.data.forEach((chat) => {
						expect(chat.prisoner).to.equal(createdPrisonerId);
					});
					done();
				});
		});
	});

	// Test GET /chat/chat?id=:id - Get a single chat
	describe('GET /chat/chat?id=:id', function () {
		it('should return a single chat if ID is valid and exists', function (done) {
			request(app)
				.get(`/chat/chat?id=${createdChatId}`)
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(true);
					expect(res.body.data[0]).to.have.property('id');
					expect(res.body.data[0].id).to.equal(createdChatId);
					done();
				});
		});

		//Returns blank array for non-existent chat ID, which is correct behavior but returns true for success
		it('should return null data if chat ID does not exist', function (done) {
			request(app)
				.get('/chat/chat?id=99999')
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.data).to.be.an('array').that.is.empty;
					expect(res.body.success).to.equal(false);
					done();
				});
		});

		it('should return error if ID is not provided or invalid', function (done) {
			request(app)
				.get('/chat/chat')
				.set('Authorization', `Bearer ${authToken}`)
				.expect(400) // Should return 400 or 404 error
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.equal(false); //Should be false, comes out true
					done();
				});
		});

		it('should return a chat by user and prisoner combination', function (done) {
			request(app)
				.get(`/chat/chat?user=${createdUserId}&prisoner=${createdPrisonerId}`)
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(true);
					expect(res.body.data).to.have.property('id');
					expect(res.body.data.user).to.equal(createdUserId);
					expect(res.body.data.prisoner).to.equal(createdPrisonerId);
					done();
				});
		});
	});

	// Should this just be impossible and we remove this test?
	// Erroring with:
	// "info": "Error updating chat.",
	// "type": "SequelizeDatabaseError",
	// "error": "SQLITE_ERROR: no such column: chat",
	// Test PUT /chat/chat - Update an existing chat
	describe('PUT /chat/chat', function () {
		it('should update an existing chat successfully', function (done) {
			request(app)
				.put('/chat/chat')
				.set('Authorization', `Bearer ${authToken}`)
				.send({
					id: createdChatId,
					prisoner: 1 // Assuming prisoner ID 1 exists
				})
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.equal(true);
					expect(res.body.data.updatedRows).to.be.at.least(1);
					done();
				});
		});

		it('should return 0 updatedRows if chat ID does not exist', function (done) {
			request(app)
				.put('/chat/chat')
				.set('Authorization', `Bearer ${authToken}`)
				.send({
					id: 99999,
					user: createdUserId,
					prisoner: createdPrisonerId
				})
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(true);
					expect(res.body.data.updatedRows).to.equal(0);
					done();
				});
		});
	});

	// Not sure why this is failing
	// Test DELETE /chat/chat - Delete a chat
	describe(`DELETE /chat/chat?id=${createdChatId}`, function () {
		it('should delete an existing chat successfully', function (done) {
			const deleteUrl = `/chat/chat?id=${createdChatId}`;
			console.log(`[DEBUG] Attempting to delete chat with URL: ${deleteUrl}`); // Added log
			request(app)
				.delete(deleteUrl)
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.equal(true);
					expect(res.body.data.data).to.be.at.least(1); // Check deletedRows
					expect(res.body.data.info).to.equal('Successfully deleted chat.'); //Successfully is misspelled here
					done();
				});
		});

		// Returns 200 success, should return 400 error, is sending undefined chat ID
		it('should return 0 if chat ID to delete does not exist', function (done) {
			request(app)
				.delete('/chat/chat')
				.set('Authorization', `Bearer ${authToken}`)
				.send({
					id: createdChatId // Already deleted
				})
				.expect(400)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(true);
					expect(res.body.data.deletedRows).to.equal(0);
					done();
				});
		});

		it('should verify that the chat was actually deleted', function (done) {
			request(app)
				.get(`/chat/chat?id=${createdChatId}`)
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);

					expect(res.body.success).to.equal(true);
					// API returns empty array when chat doesn't exist
					expect(res.body.data).to.be.an('array').that.is.empty;
					done();
				});
		});
	});
});
