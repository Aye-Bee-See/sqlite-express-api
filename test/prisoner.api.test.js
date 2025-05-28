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

describe('Prisoners API', function() { // Using 'function' for Mocha context
    let server;
    let db; // To hold the database connection
    let createdPrisonerId; // To store the ID of a created prisoner for subsequent tests

    // Before all tests, set up the test database and start the server
    before(function(done) { // Using 'before' for Mocha setup
        this.timeout(10000); // Increase timeout for database operations if needed

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
                db.close(() => { // Close the setup connection
                    // Set the environment variable to use the test database
                    process.env.DB_PATH = TEST_DB_PATH;
                    // Start the Express app server on a specific port for testing
                    server = app.listen(4002, () => { // Use a different port than user tests
                        console.log('Test server started on port 4002 for Prisoner API tests.');
                        done(); // Signal that setup is complete
                    });
                });
            });
        });
    });

    // After all tests, clean up the test database and close the server
    after(function(done) { // Using 'after' for Mocha cleanup
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
    it('should return all prisoners', function(done) {
        request(app)
            .get('/api/prisoners')
            .expect(200)
            .end((err, res) => {
                if (err) return done(err);
                expect(res.body).to.be.an('array');
                done();
            });
    });

    // Test POST /api/prisoners - Create a new prisoner
    it('should create a new prisoner successfully', function(done) {
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
            .post('/api/prisoners')
            .send(newPrisoner)
            .set('Accept', 'application/json')
            .expect(201) // 201 Created
            .end((err, res) => {
                if (err) return done(err);
                expect(res.body).to.have.property('id');
                expect(res.body.birthName).to.equal(newPrisoner.birthName);
                expect(res.body.chosenName).to.equal(newPrisoner.chosenName);
                expect(res.body.prison).to.equal(newPrisoner.prison);
                expect(res.body.inmateID).to.equal(newPrisoner.inmateID);
                expect(res.body.releaseDate).to.equal(newPrisoner.releaseDate);
                expect(res.body.bio).to.equal(newPrisoner.bio);
                expect(res.body.status).to.equal(newPrisoner.status);
                createdPrisonerId = res.body.id; // Save the ID for later tests
                done();
            });
    });

    // Test GET /api/prisoners/:id - Get a prisoner by ID (success)
    it('should return a single prisoner if found', function(done) {
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
                .post('/api/prisoners')
                .send(tempPrisoner)
                .end((err, res) => {
                    if (err) return done(err);
                    createdPrisonerId = res.body.id;
                    fetchPrisoner();
                });
        } else {
            fetchPrisoner();
        }

        function fetchPrisoner() {
            request(app)
                .get(`/api/prisoners/${createdPrisonerId}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body).to.have.property('id', createdPrisonerId);
                    expect(res.body).to.have.property('birthName', 'John Doe'); // From the POST test
                    expect(res.body).to.have.property('inmateID', 'INM001');
                    done();
                });
        }
    });

    // Test GET /api/prisoners/:id - Get a prisoner by ID (not found)
    it('should return 404 if prisoner not found', function(done) {
        const nonExistentId = 99999; // Assuming this ID won't exist
        request(app)
            .get(`/api/prisoners/${nonExistentId}`)
            .expect(404)
            .end((err, res) => {
                if (err) return done(err);
                expect(res.body).to.have.property('message', 'Prisoner not found');
                done();
            });
    });

    // Test PUT /api/prisoners/:id - Update an existing prisoner
    it('should update an existing prisoner', function(done) {
        const updatedPrisoner = {
            birthName: 'Jane Smith',
            chosenName: 'J. Smith',
            prison: 1,
            inmateID: 'INM001-UPDATED',
            releaseDate: '2032-03-03T00:00:00.000Z',
            bio: 'Updated test prisoner bio.',
            status: 'free'
        };
        request(app)
            .put(`/api/prisoners/${createdPrisonerId}`)
            .send(updatedPrisoner)
            .set('Accept', 'application/json')
            .expect(200)
            .end((err, res) => {
                if (err) return done(err);
                expect(res.body).to.have.property('id', createdPrisonerId);
                expect(res.body.birthName).to.equal(updatedPrisoner.birthName);
                expect(res.body.chosenName).to.equal(updatedPrisoner.chosenName);
                expect(res.body.prison).to.equal(updatedPrisoner.prison);
                expect(res.body.inmateID).to.equal(updatedPrisoner.inmateID);
                expect(res.body.releaseDate).to.equal(updatedPrisoner.releaseDate);
                expect(res.body.bio).to.equal(updatedPrisoner.bio);
                expect(res.body.status).to.equal(updatedPrisoner.status);

                // Verify the update by fetching the prisoner again
                request(app)
                    .get(`/api/prisoners/${createdPrisonerId}`)
                    .expect(200)
                    .end((err, getRes) => {
                        if (err) return done(err);
                        expect(getRes.body.birthName).to.equal(updatedPrisoner.birthName);
                        expect(getRes.body.inmateID).to.equal(updatedPrisoner.inmateID);
                        expect(getRes.body.status).to.equal(updatedPrisoner.status);
                        done();
                    });
            });
    });

    // Test PUT /api/prisoners/:id - Update a non-existent prisoner
    it('should return 404 if prisoner to update not found', function(done) {
        const nonExistentId = 99999;
        const updatedPrisoner = {
            birthName: 'Non Existent',
            chosenName: 'N. Existent',
            prison: 99,
            inmateID: 'INM999',
            releaseDate: '2040-01-01T00:00:00.000Z',
            bio: 'Non existent bio.',
            status: 'incarcerated'
        };
        request(app)
            .put(`/api/prisoners/${nonExistentId}`)
            .send(updatedPrisoner)
            .set('Accept', 'application/json')
            .expect(404)
            .end((err, res) => {
                if (err) return done(err);
                expect(res.body).to.have.property('message', 'Prisoner not found');
                done();
            });
    });

    // Test DELETE /api/prisoners/:id - Delete a prisoner
    it('should delete a prisoner', function(done) {
        request(app)
            .delete(`/api/prisoners/${createdPrisonerId}`)
            .expect(204) // 204 No Content for successful deletion
            .end((err, res) => {
                if (err) return done(err);
                // Verify deletion by trying to fetch the prisoner again
                request(app)
                    .get(`/api/prisoners/${createdPrisonerId}`)
                    .expect(404)
                    .end((err, getRes) => {
                        if (err) return done(err);
                        expect(getRes.body).to.have.property('message', 'Prisoner not found');
                        done();
                    });
            });
    });

    // Test DELETE /api/prisoners/:id - Delete a non-existent prisoner
    it('should return 404 if prisoner to delete not found', function(done) {
        const nonExistentId = 99999;
        request(app)
            .delete(`/api/prisoners/${nonExistentId}`)
            .expect(404)
            .end((err, res) => {
                if (err) return done(err);
                expect(res.body).to.have.property('message', 'Prisoner not found');
                done();
            });
    });
});
