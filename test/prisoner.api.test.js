// prisoners.api.test.js

import request from 'supertest';
import { expect } from 'chai'; // Using Chai for assertions
import app from '../index.js'; // Assuming your Express app is exported from app.js or index.js
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the current file's path from its URL
const __filename = fileURLToPath(import.meta.url);
// Get the directory name from the file path
const __dirname = dirname(__filename);

// Define the path for the test database. Using a separate database for tests
const TEST_DB_PATH = path.join(__dirname, 'prisonerData_test.db');

describe('Prisoners API', function () {
	// Using 'function' for Mocha context
	let server;
	let db; // To hold the database connection
	let createdPrisonerId; // To store the ID of a created prisoner for subsequent tests
	let authToken; // Store JWT for authenticated requests
	let createdUserId; // Store user ID if needed

	// Before all tests, set up the test database and start the server
	before(function (done) {
		// Using 'before' for Mocha setup
		this.timeout(15000); // Increase timeout for database operations if needed

		// Delete the test database file if it exists to ensure a clean slate
		if (fs.existsSync(TEST_DB_PATH)) {
			fs.unlinkSync(TEST_DB_PATH);
		}

		// Connect to the test database. If the file doesn't exist, it will be created.
		db = new sqlite3.Database(TEST_DB_PATH, (err) => {
			if (err) {
				console.error('Error opening test database:', err.message);
				return done(err);
			}
			console.log('Connected to the test SQLite database for prisoners.');

			// Create the 'prisoner' table in the test database
			const createTableSql = `
                CREATE TABLE IF NOT EXISTS prisoner (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    birthName TEXT,
                    chosenName TEXT,
                    prison INTEGER,
                    inmateID TEXT,
                    releaseDate TEXT, -- Storing as TEXT for simplicity with ISO strings
                    bio TEXT,
                    status TEXT
                );
            `;
			db.run(createTableSql, (err) => {
				if (err) {
					console.error('Error creating prisoner table:', err.message);
					return done(err);
				}
				console.log('Prisoner table created or already exists in test database.');
				db.close(() => {
					process.env.DB_PATH = TEST_DB_PATH;
					// Create a user and login to get JWT
					request(app)
						.post('/auth/user')
						.send({
							username: 'prisonerapitestuser',
							name: 'Prisoner API Test User',
							password: 'testpassword',
							email: 'prisonerapitest@abc.com',
							role: 'admin'
						})
						.expect(200)
						.end((err, res) => {
							if (err) return done(err);
							createdUserId = res.body.data.id;
							request(app)
								.post('/auth/login')
								.send({
									username: 'prisonerapitestuser',
									password: 'testpassword'
								})
								.expect(200)
								.end((err, res) => {
									if (err) return done(err);
									authToken = res.body.data.token.token;
									server = app.listen(4002, () => {
										console.log('Test server started on port 4002 for Prisoner API tests.');
										done();
									});
								});
						});
				});
			});
		});
	});

	// After all tests, clean up the test database and close the server
	after(function (done) {
		// Using 'after' for Mocha cleanup
		this.timeout(5000); // Increase timeout for cleanup if needed

		// Close the database connection if it's still open from a test
		// (though it should be closed by individual tests if they open it)
		// Re-open just to ensure we can delete the file
		const tempDb = new sqlite3.Database(TEST_DB_PATH, (err) => {
			if (err) {
				console.error('Error opening db for cleanup:', err.message);
				// Still try to delete the file even if opening fails
			}
			if (tempDb) {
				tempDb.close(() => {
					if (fs.existsSync(TEST_DB_PATH)) {
						fs.unlinkSync(TEST_DB_PATH);
						console.log('Test database file deleted.');
					}
					if (server) {
						server.close(() => {
							console.log('Test server closed.');
							done(); // Signal that cleanup is complete
						});
					} else {
						done();
					}
				});
			} else {
				if (fs.existsSync(TEST_DB_PATH)) {
					fs.unlinkSync(TEST_DB_PATH);
					console.log('Test database file deleted.');
				}
				if (server) {
					server.close(() => {
						console.log('Test server closed.');
						done();
					});
				} else {
					done();
				}
			}
		});
	});

	// Test GET /api/prisoners - Get all prisoners
	it('should return all prisoners', function (done) {
		request(app)
			.get('/prisoner/prisoners')
			.set('Authorization', `Bearer ${authToken}`)
			.expect(200)
			.end((err, res) => {
				if (err) return done(err);
				expect(res.body.data).to.be.an('array');
				done();
			});
	});

	// Test POST /api/prisoners - Create a new prisoner
	it('should create a new prisoner successfully', function (done) {
		const newPrisoner = {
			birthName: 'John Doe',
			chosenName: 'J. Doe',
			prison: 1,
			inmateID: 'INM001',
			releaseDate: '2030-01-01T00:00:00.000Z',
			bio: 'First test prisoner bio.',
			status: 'incarcerated'
		};
		request(app)
			.post('/prisoner/prisoner')
			.set('Authorization', `Bearer ${authToken}`)
			.send(newPrisoner)
			.set('Accept', 'application/json')
			.expect(200) // 200 Created
			.end((err, res) => {
				if (err) return done(err);
				expect(res.body.data).to.have.property('id');
				expect(res.body.data.birthName).to.equal(newPrisoner.birthName);
				expect(res.body.data.chosenName).to.equal(newPrisoner.chosenName);
				expect(res.body.data.prison).to.equal(newPrisoner.prison);
				expect(res.body.data.inmateID).to.equal(newPrisoner.inmateID);
				expect(res.body.data.releaseDate).to.equal(newPrisoner.releaseDate);
				expect(res.body.data.bio).to.equal(newPrisoner.bio);
				expect(res.body.data.status).to.equal(newPrisoner.status);
				createdPrisonerId = res.body.id; // Save the ID for later tests
				done();
			});
	});

	// Test GET /prisoner/prisoners/:id - Get a prisoner by ID (success)
	it('should return a single prisoner if found', function (done) {
		// Ensure a prisoner exists before trying to fetch it
		if (!createdPrisonerId) {
			// This case should ideally not happen if tests run in order,
			// but as a fallback, create one.
			const tempPrisoner = {
				birthName: 'Temp Name',
				chosenName: 'T. Name',
				prison: 2,
				inmateID: 'INM002',
				releaseDate: '2031-02-02T00:00:00.000Z',
				bio: 'Temporary prisoner for test.',
				status: 'pending, pretrial'
			};
			request(app)
				.post('/prisoner/prisoner')
				.set('Authorization', `Bearer ${authToken}`)
				.send(tempPrisoner)
				.end((err, res) => {
					if (err) return done(err);
					if (!res.body.data || !res.body.data.id) {
						return done(new Error('Failed to create prisoner for test'));
					}
					createdPrisonerId = res.body.data.id;
					fetchPrisoner();
				});
		} else {
			fetchPrisoner();
		}

		function fetchPrisoner() {
			if (!createdPrisonerId) return done(new Error('createdPrisonerId is not set'));
			request(app)
				.get(`/prisoner/prisoner/?id=${createdPrisonerId}`)
				.set('Authorization', `Bearer ${authToken}`)
				.expect(200)
				.end((err, res) => {
					if (err) return done(err);
					expect(res.body.data).to.have.property('id', createdPrisonerId);
					expect(res.body.data).to.have.property('birthName', 'Temp Name'); // From the POST test
					expect(res.body.data).to.have.property('inmateID', 'INM002');
					done();
				});
		}
	});

	// Test GET /api/prisoners/:id - Get a prisoner by ID (not found)
	it('should fail if prisoner not found', function (done) {
		const nonExistentId = 99999; // Assuming this ID won't exist
		request(app)
			.get(`/prisoner/prisoner?id=${nonExistentId}`)
			.set('Authorization', `Bearer ${authToken}`)
			.expect(200)
			.end((err, res) => {
				if (err) return done(err);
				expect(res.body.data).to.be.null;
				done();
			});
	});

	// Test PUT /api/prisoners/:id - Update an existing prisoner
	it('should update an existing prisoner', function (done) {
		const updatedPrisoner = {
			id: createdPrisonerId,
			birthName: 'Jane Smith',
			chosenName: 'J. Smith',
			prison: 1,
			inmateID: 'INM001-UPDATED',
			releaseDate: '2032-03-03T00:00:00.000Z',
			bio: 'Updated test prisoner bio.',
			status: 'free'
		};
		request(app)
			.put(`/prisoner/prisoner`)
			.set('Authorization', `Bearer ${authToken}`)
			.send(updatedPrisoner)
			.set('Accept', 'application/json')
			.expect(200)
			.end((err, res) => {
				if (err) return done(err);
				expect(res.body.data.newPrisoner).to.have.property('id', createdPrisonerId);
				expect(res.body.data.newPrisoner.birthName).to.equal(updatedPrisoner.birthName);
				expect(res.body.data.newPrisoner.chosenName).to.equal(updatedPrisoner.chosenName);
				expect(res.body.data.newPrisoner.prison).to.equal(updatedPrisoner.prison);
				expect(res.body.data.newPrisoner.inmateID).to.equal(updatedPrisoner.inmateID);
				expect(res.body.data.newPrisoner.releaseDate).to.equal(updatedPrisoner.releaseDate);
				expect(res.body.data.newPrisoner.bio).to.equal(updatedPrisoner.bio);
				expect(res.body.data.newPrisoner.status).to.equal(updatedPrisoner.status);

				// Verify the update by fetching the prisoner again
				request(app)
					.get(`/prisoner/prisoner?id=${createdPrisonerId}`)
					.set('Authorization', `Bearer ${authToken}`)
					.expect(200)
					.end((err, getRes) => {
						if (err) return done(err);
						expect(res.body.data.updatedRows).to.equal(1); //Should return 1 updated row, currently returns 1 in an array
						expect(getRes.body.data.birthName).to.equal(updatedPrisoner.birthName);
						expect(getRes.body.data.inmateID).to.equal(updatedPrisoner.inmateID);
						expect(getRes.body.data.status).to.equal(updatedPrisoner.status);
						done();
					});
			});
	});

	// Test PUT /api/prisoners/:id - Update a non-existent prisoner
	it('should return 404 if prisoner to update not found', function (done) {
		const updatedPrisoner = {
			id: 99999,
			birthName: 'Non Existent',
			chosenName: 'N. Existent',
			prison: 99,
			inmateID: 'INM999',
			releaseDate: '2040-01-01T00:00:00.000Z',
			bio: 'Non existent bio.',
			status: 'incarcerated'
		};
		request(app)
			.put(`/prisoner/prisoner`)
			.set('Authorization', `Bearer ${authToken}`)
			.send(updatedPrisoner)
			.set('Accept', 'application/json')
			.expect(404) // Should return 404 Not Found
			.end((err, res) => {
				if (err) return done(err);
				expect(res.body.data.updatedRows).to.be.an('array').that.includes(0);
				done();
			});
	});

	// Test DELETE /prisoner/prisoner/ - Delete a prisoner
	it('should delete a prisoner', function (done) {
		request(app)
			.delete(`/prisoner/prisoner`)
			.set('Authorization', `Bearer ${authToken}`)
			.send({ id: createdPrisonerId })
			.expect(200)
			.end((err, res) => {
				if (err) return done(err);
				// Verify deletion by trying to fetch the prisoner again
				request(app)
					.get(`/prisoner/prisoner?id=${createdPrisonerId}`)
					.set('Authorization', `Bearer ${authToken}`)
					.expect(200)
					.end((err, getRes) => {
						if (err) return done(err);
						expect(res.body.deletedRows).to.equal(1); // Should return 1 deleted row, currently returns 1 in an array
						done();
					});
			});
	});

	// Test DELETE /prisoner/prisoner - Delete a non-existent prisoner
	it('should return 404 if prisoner to delete not found', function (done) {
		const nonExistentId = 99999;
		request(app)
			.delete(`/prisoner/prisoner/${nonExistentId}`)
			.set('Authorization', `Bearer ${authToken}`)
			.expect(404) // Should return 404 Not Found
			.end((err, res) => {
				if (err) return done(err);
				expect(res.body.data).to.equal(0);
				done();
			});
	});
});
