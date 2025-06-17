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
const CHAPTER_TEST_DB_PATH = path.join(__dirname, 'chapter_test.db');
const USER_DB_PATH = path.join(__dirname, 'chapter_user_test.db'); // Separate user DB for these tests

describe('Chapters API', function () {
	let server;
	let chapterDb; // Renaming to avoid conflict with 'db' if it's used differently
	let createdChapterId;
	let authToken;
	let createdUserId;

	// Before all tests, set up the test databases and start the server
	before(function (done) {
		this.timeout(25000); // Increased timeout for multiple DB setups

		// Delete test databases if they exist to ensure a clean slate
		if (fs.existsSync(CHAPTER_TEST_DB_PATH)) {
			fs.unlinkSync(CHAPTER_TEST_DB_PATH);
		}
		if (fs.existsSync(USER_DB_PATH)) {
			fs.unlinkSync(USER_DB_PATH);
		}

		// 1. Connect to the user test database and set it up
		const userDbConnection = new sqlite3.Database(USER_DB_PATH, (err) => {
			if (err) {
				console.error('Error opening user test database for chapters:', err.message);
				return done(err);
			}
			console.log('Connected to the user test SQLite database for chapters.');
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
			userDbConnection.run(createUserTableSql, (err) => {
				if (err) {
					console.error('Error creating user table for chapter tests:', err.message);
					userDbConnection.close();
					return done(err);
				}
				console.log('User table created or already exists in user test database for chapters.');
				userDbConnection.close(() => {
					// 2. Connect to the chapter test database and set it up
					chapterDb = new sqlite3.Database(CHAPTER_TEST_DB_PATH, (err) => {
						if (err) {
							console.error('Error opening chapter test database:', err.message);
							return done(err);
						}
						console.log('Connected to the chapter test SQLite database.');
						const createChapterTableSql = `
                            CREATE TABLE IF NOT EXISTS chapter (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                name TEXT NOT NULL,
                                location TEXT NOT NULL, -- Storing JSON as TEXT
                                prisoners TEXT,          -- Storing JSON as TEXT, nullable
                                lettersSent TEXT,        -- Nullable
                                averageTimeDays INTEGER  -- Nullable
                            );
                        `;
						chapterDb.run(createChapterTableSql, (err) => {
							if (err) {
								console.error('Error creating chapter table:', err.message);
								chapterDb.close();
								return done(err);
							}
							console.log('Chapter table created or already exists in chapter test database.');
							chapterDb.close(() => {
								// 3. Set environment variables for DB paths
								process.env.DB_PATH = CHAPTER_TEST_DB_PATH; // Main DB for chapters
								process.env.USER_DB_PATH = USER_DB_PATH; // User DB for auth

								// 4. Create a user and login to get JWT
								request(app)
									.post('/auth/user') // Assuming user routes are available
									.send({
										username: 'chaptertestuser',
										name: 'Chapter Test User',
										password: 'testpassword123',
										email: 'chaptertest@example.com',
										role: 'admin'
									})
									.expect(200)
									.end((err, res) => {
										if (err) {
											console.error('Error creating user for chapter tests:', res ? res.body : err);
											return done(err);
										}
										if (!res.body.data || !res.body.data.id) {
											console.error(
												'User creation response missing data for chapter tests:',
												res.body
											);
											return done(new Error('User creation failed for chapter tests'));
										}
										createdUserId = res.body.data.id;
										request(app)
											.post('/auth/login')
											.send({
												username: 'chaptertestuser',
												password: 'testpassword123'
											})
											.expect(200)
											.end((err, res) => {
												if (err) {
													console.error(
														'Error logging in user for chapter tests:',
														res ? res.body : err
													);
													return done(err);
												}
												if (!res.body.data || !res.body.data.token || !res.body.data.token.token) {
													console.error(
														'Login response missing token for chapter tests:',
														res.body
													);
													return done(new Error('Auth token not received for chapter tests'));
												}
												authToken = res.body.data.token.token;

												// 5. Start the server
												server = app.listen(4004, () => {
													// Use a different port
													console.log('Test server started on port 4004 for Chapter API tests.');
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

	// After all tests, clean up
	after(function (done) {
		this.timeout(15000);
		const cleanupTasks = [];

		cleanupTasks.push((cb) => {
			if (fs.existsSync(CHAPTER_TEST_DB_PATH)) {
				fs.unlink(CHAPTER_TEST_DB_PATH, (err) => {
					if (err) console.error('Error deleting chapter test database:', err.message);
					else console.log('Chapter test database deleted.');
					cb();
				});
			} else {
				cb();
			}
		});

		cleanupTasks.push((cb) => {
			if (fs.existsSync(USER_DB_PATH)) {
				fs.unlink(USER_DB_PATH, (err) => {
					if (err) console.error('Error deleting user test database for chapters:', err.message);
					else console.log('User test database for chapters deleted.');
					cb();
				});
			} else {
				cb();
			}
		});

		let tasksCompleted = 0;
		const totalTasks = cleanupTasks.length + (server ? 1 : 0);

		function checkDone() {
			tasksCompleted++;
			if (tasksCompleted >= totalTasks) {
				// Use >= to be safe
				done();
			}
		}

		cleanupTasks.forEach((task) => task(checkDone));

		if (server) {
			server.close((err) => {
				if (err) console.error('Error closing server for chapter tests:', err);
				else console.log('Test server for chapters closed.');
				checkDone();
			});
		} else if (cleanupTasks.length === 0) {
			// If no server and no DB tasks
			done();
		} else if (tasksCompleted === cleanupTasks.length && !server) {
			// All DB tasks done, no server
			done();
		}
	});

	// Test POST /chapter/chapter - Create a new chapter
	describe('POST /chapter/chapter', function () {
		it('should create a new chapter successfully', function (done) {
			const newChapter = {
				name: 'Golden Gate Chapter',
				location: JSON.stringify({ street: '123 Bridge Way', city: 'San Francisco', state: 'CA' })
			};
			request(app)
				.post('/chapter/chapter')
				.set('Authorization', `Bearer ${authToken}`)
				.send(newChapter)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.true;
					expect(res.body.data).to.have.property('id');
					expect(res.body.data.name).to.equal(newChapter.name);
					expect(JSON.parse(res.body.data.location)).to.deep.equal(JSON.parse(newChapter.location));
					createdChapterId = res.body.data.id; // Save for later tests
					done();
				});
		});

		it('should return error if name is missing', function (done) {
			const newChapter = {
				// name is missing
				location: JSON.stringify({ street: '456 Main St', city: 'Anytown' })
			};
			request(app)
				.post('/chapter/chapter')
				.set('Authorization', `Bearer ${authToken}`)
				.send(newChapter)
				.expect(400)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.false;
					done();
				});
		});

		it('should return error if location is missing', function (done) {
			const newChapter = {
				name: 'No Location Chapter'
				// location is missing
			};
			request(app)
				.post('/chapter/chapter')
				.set('Authorization', `Bearer ${authToken}`)
				.send(newChapter)
				.expect(400)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.false;
					done();
				});
		});
	});

	// Test GET /chapter/chapters - Get all chapters
	describe('GET /chapter/chapters', function () {
		it('should return all chapters', function (done) {
			request(app)
				.get('/chapter/chapters')
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.true;
					expect(res.body.data).to.be.an('array');
					if (createdChapterId) {
						// Only check if a chapter was successfully created
						const found = res.body.data.some((chapter) => chapter.id === createdChapterId);
						expect(found).to.be.true;
					}
					done();
				});
		});
	});

	// Test GET /chapter/chapter?id=:id - Get a single chapter
	describe('GET /chapter/chapter?id=:id', function () {
		it('should return a single chapter if ID is valid and exists', function (done) {
			if (!createdChapterId) {
				this.skip(); // Skip if no chapter was created in POST test
				return done();
			}
			request(app)
				.get(`/chapter/chapter?id=${createdChapterId}`)
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.true;
					expect(res.body.data).to.have.property('id', createdChapterId);
					expect(res.body.data.name).to.equal('Golden Gate Chapter'); // From the POST test
					done();
				});
		});

		it('should return null data if chapter ID does not exist', function (done) {
			request(app)
				.get('/chapter/chapter?id=99999') // Non-existent ID
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.true;
					expect(res.body.data).to.be.null;
					done();
				});
		});

		it('should return error if ID is not provided or invalid', function (done) {
			request(app)
				.get('/chapter/chapter') // No ID
				.set('Authorization', `Bearer ${authToken}`)
				.expect(400) // Based on typical controller behavior for missing required param for getOne
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.false;
					// Check for a specific error message if your API provides one
					// e.g., expect(res.body.errors).to.include('ID is required');
					done();
				});
		});
	});

	// Test PUT /chapter/chapter - Update an existing chapter
	describe('PUT /chapter/chapter', function () {
		it('should update an existing chapter successfully', function (done) {
			if (!createdChapterId) {
				this.skip();
				return done();
			}
			const updatedChapter = {
				id: createdChapterId,
				name: 'Golden Gate Chapter - Updated',
				location: JSON.stringify({ street: '456 Bridge Ave', city: 'Oakland', state: 'CA' }),
				lettersSent: '150',
				averageTimeDays: 30
			};
			request(app)
				.put('/chapter/chapter')
				.set('Authorization', `Bearer ${authToken}`)
				.send(updatedChapter)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.true;
					expect(res.body.data.updatedRows).to.be.an('array').that.includes(1);
					expect(res.body.data.newChapter.name).to.equal(updatedChapter.name);
					expect(JSON.parse(res.body.data.newChapter.location)).to.deep.equal(
						JSON.parse(updatedChapter.location)
					);
					expect(res.body.data.newChapter.lettersSent).to.equal(updatedChapter.lettersSent);
					expect(res.body.data.newChapter.averageTimeDays).to.equal(updatedChapter.averageTimeDays);
					done();
				});
		});

		it('should return 0 updatedRows if chapter ID does not exist', function (done) {
			const updatedChapter = {
				id: 99999, // Non-existent ID
				name: 'Non Existent Chapter Updated',
				location: JSON.stringify({ street: '123 Nowhere St', city: 'Nocity' })
			};
			request(app)
				.put('/chapter/chapter')
				.set('Authorization', `Bearer ${authToken}`)
				.send(updatedChapter)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.true;
					expect(res.body.data.updatedRows).to.be.an('array').that.includes(0);
					done();
				});
		});
	});

	// Test DELETE /chapter/chapter - Delete a chapter
	describe('DELETE /chapter/chapter', function () {
		it('should delete an existing chapter successfully', function (done) {
			if (!createdChapterId) {
				this.skip();
				return done();
			}
			request(app)
				.delete('/chapter/chapter')
				.set('Authorization', `Bearer ${authToken}`)
				.send({ id: createdChapterId })
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.true;
					expect(res.body.data).to.equal(1); // 1 row deleted

					// Verify by trying to get it
					request(app)
						.get(`/chapter/chapter?id=${createdChapterId}`)
						.set('Authorization', `Bearer ${authToken}`)
						.expect(200)
						.end((err, res) => {
							if (err) return done(err);
							expect(res.body.data).to.be.null; // Should not be found
							done();
						});
				});
		});

		it('should return 0 if chapter ID to delete does not exist', function (done) {
			request(app)
				.delete('/chapter/chapter')
				.set('Authorization', `Bearer ${authToken}`)
				.send({ id: 99999 }) // Non-existent ID
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.success).to.be.true;
					expect(res.body.data).to.equal(0);
					done();
				});
		});
	});
});
