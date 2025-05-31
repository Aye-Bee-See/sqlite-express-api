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

// Define the path for the test database.
const TEST_DB_PATH = path.join(__dirname, 'prison_test.db');
const USER_DB_PATH = path.join(__dirname, 'userData_test.db'); // For user auth

describe('Prisons API', function() {
    let server;
    let db;
    let createdPrisonId;
    let authToken;
    let createdUserId;

    // Before all tests, set up the test databases and start the server
    before(function(done) {
        this.timeout(20000); // Increased timeout for multiple DB setups

        // Delete test databases if they exist
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        if (fs.existsSync(USER_DB_PATH)) {
            fs.unlinkSync(USER_DB_PATH);
        }

        // Connect to the user test database
        const userDb = new sqlite3.Database(USER_DB_PATH, (err) => {
            if (err) {
                console.error('Error opening user test database:', err.message);
                return done(err);
            }
            console.log('Connected to the user test SQLite database.');
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
                    console.error('Error creating user table:', err.message);
                    userDb.close();
                    return done(err);
                }
                console.log('User table created or already exists in user test database.');
                userDb.close(() => {
                    // Now connect to the prison test database
                    db = new sqlite3.Database(TEST_DB_PATH, (err) => {
                        if (err) {
                            console.error('Error opening prison test database:', err.message);
                            return done(err);
                        }
                        console.log('Connected to the prison test SQLite database.');
                        const createPrisonTableSql = `
                            CREATE TABLE IF NOT EXISTS prison (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                prisonName TEXT NOT NULL,
                                address TEXT NOT NULL, -- Storing JSON as TEXT
                                deleted INTEGER DEFAULT 0 -- Assuming 0 for false, 1 for true
                            );
                        `;
                        db.run(createPrisonTableSql, (err) => {
                            if (err) {
                                console.error('Error creating prison table:', err.message);
                                db.close();
                                return done(err);
                            }
                            console.log('Prison table created or already exists in prison test database.');
                            db.close(() => {
                                process.env.DB_PATH = TEST_DB_PATH; // Main DB for prisons
                                process.env.USER_DB_PATH = USER_DB_PATH; // Separate DB for users

                                // Create a user and login to get JWT
                                request(app)
                                    .post('/auth/user')
                                    .send({
                                        username: 'prisonapitestuser',
                                        name: 'Prison API Test User',
                                        password: 'testpassword123',
                                        email: 'prisontest@example.com',
                                        role: 'admin'
                                    })
                                    .expect(200)
                                    .end((err, res) => {
                                        if (err) {
                                            console.error("Error creating user for prison tests:", res ? res.body : err);
                                            return done(err);
                                        }
                                        createdUserId = res.body.data.id;
                                        request(app)
                                            .post('/auth/login')
                                            .send({
                                                username: 'prisonapitestuser',
                                                password: 'testpassword123'
                                            })
                                            .expect(200)
                                            .end((err, res) => {
                                                if (err) {
                                                    console.error("Error logging in user for prison tests:", res ? res.body : err);
                                                    return done(err);
                                                }
                                                authToken = res.body.data.token.token;
                                                if (!authToken) {
                                                    return done(new Error('Auth token not received'));
                                                }
                                                server = app.listen(4003, () => { // Use a different port
                                                    console.log('Test server started on port 4003 for Prison API tests.');
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
    after(function(done) {
        this.timeout(10000);
        const cleanupTasks = [];

        if (db && typeof db.close === 'function') {
             // Ensure db is open before trying to close, or sqlite throws error if already closed.
            // For simplicity, we'll just attempt to delete.
        }

        cleanupTasks.push((cb) => {
            if (fs.existsSync(TEST_DB_PATH)) {
                fs.unlink(TEST_DB_PATH, (err) => {
                    if (err) console.error('Error deleting prison test database:', err.message);
                    else console.log('Prison test database deleted.');
                    cb(); // Call cb even if unlink fails
                });
            } else {
                cb();
            }
        });

        cleanupTasks.push((cb) => {
            if (fs.existsSync(USER_DB_PATH)) {
                fs.unlink(USER_DB_PATH, (err) => {
                    if (err) console.error('Error deleting user test database:', err.message);
                    else console.log('User test database deleted.');
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
            if (tasksCompleted === totalTasks) {
                done();
            }
        }

        cleanupTasks.forEach(task => task(checkDone));

        if (server) {
            server.close(() => {
                console.log('Test server closed.');
                checkDone();
            });
        } else if (totalTasks === 0) { // Handle case where server might not have started
             done();
        }
    });

    // Test POST /prison/prison - Create a new prison
    describe('POST /prison/prison', function() {
        it('should create a new prison successfully', function(done) {
            const newPrison = {
                prisonName: 'Alcatraz II',
                address: JSON.stringify({ street: '1 Rock Island', city: 'San Francisco', zip: '94123' }),
                // deleted is not part of creation, defaults in schema/DB
            };
            request(app)
                .post('/prison/prison')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newPrison)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.have.property('id');
                    expect(res.body.data.prisonName).to.equal(newPrison.prisonName);
                    expect(JSON.parse(res.body.data.address)).to.deep.equal(JSON.parse(newPrison.address));
                    createdPrisonId = res.body.data.id; // Save for later tests
                    done();
                });
        });

        it('should return error if prisonName is missing', function(done) {
            const newPrison = {
                // prisonName is missing
                address: JSON.stringify({ street: '123 Main St', city: 'Anytown', zip: '12345' }),
            };
            request(app)
                .post('/prison/prison')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newPrison)
                .expect(400) // Or whatever error code your API returns for validation
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.false;
                    // Add specific error message check if available
                    expect(res.body.errors).to.be.an('array').that.includes('Prison.prisonName cannot be null');
                    done();
                });
        });

        it('should return error if address is missing', function(done) {
            const newPrison = {
                prisonName: 'No Address Prison',
                // address is missing
            };
            request(app)
                .post('/prison/prison')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newPrison)
                .expect(400)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.false;
                    expect(res.body.errors).to.be.an('array').that.includes('Prison.address cannot be null');
                    done();
                });
        });
    });

    // Test GET /prison/prisons - Get all prisons
    describe('GET /prison/prisons', function() {
        it('should return all prisons', function(done) {
            request(app)
                .get('/prison/prisons?page_size=9999')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.be.an('array');
                    // Check if the created prison is in the list
                    const found = res.body.data.some(prison => prison.id === createdPrisonId);
                    expect(found).to.be.true;
                    done();
                });
        });
    });

    // Test GET /prison/prison?id=:id - Get a single prison
    describe('GET /prison/prison?id=:id', function() {
        it('should return a single prison if ID is valid and exists', function(done) {
            if (!createdPrisonId) {
                this.skip(); // Skip if no prison was created
                return done();
            }
            request(app)
                .get(`/prison/prison?id=${createdPrisonId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.have.property('id', createdPrisonId);
                    expect(res.body.data.prisonName).to.equal('Alcatraz II'); // From the POST test
                    done();
                });
        });

        it('should return null data if prison ID does not exist', function(done) {
            request(app)
                .get('/prison/prison?id=99999') // Non-existent ID
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200) // API returns 200 with null data for not found
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true; // The operation itself was successful
                    expect(res.body.data).to.be.null;
                    done();
                });
        });
         it('should return error if ID is not provided or invalid', function(done) {
            request(app)
                .get('/prison/prison') // No ID
                .set('Authorization', `Bearer ${authToken}`)
                .expect(400) // Or your API's error for missing/invalid param
                .end((err, res) => {
                    if (err) return done(err);
                    // expect(res.body.success).to.be.false;
                    expect(res.body.info).to.equal("Error getting prison by ID");
                    // Add specific error message check
                    done();
                });
        });
    });

    // Test PUT /prison/prison - Update an existing prison
    describe('PUT /prison/prison', function() {
        it('should update an existing prison successfully', function(done) {
            if (!createdPrisonId) {
                this.skip();
                return done();
            }
            const updatedPrison = {
                id: createdPrisonId,
                prisonName: 'Alcatraz III: The Return',
                address: JSON.stringify({ street: '2 Rock Island', city: 'San Francisco Bay', zip: '94124' }),
                deleted: 0
            };
            request(app)
                .put('/prison/prison')
                .set('Authorization', `Bearer ${authToken}`)
                .send(updatedPrison)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data.updatedRows).to.be.an('array').that.includes(1);
                    expect(res.body.data.newPrison.prisonName).to.equal(updatedPrison.prisonName);
                    expect(JSON.parse(res.body.data.newPrison.address)).to.deep.equal(JSON.parse(updatedPrison.address));
                    done();
                });
        });

        it('should return 0 updatedRows if prison ID does not exist', function(done) {
            const updatedPrison = {
                id: 99999, // Non-existent ID
                prisonName: 'Non Existent Prison Updated',
                address: JSON.stringify({ street: '123 Nowhere St', city: 'Nocity', zip: '00000' }),
                deleted: 0
            };
            request(app)
                .put('/prison/prison')
                .set('Authorization', `Bearer ${authToken}`)
                .send(updatedPrison)
                .expect(200) // API returns 200 but indicates 0 rows updated
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data.updatedRows).to.be.an('array').that.includes(0);
                    done();
                });
        });
    });

    // Test DELETE /prison/prison - Delete a prison
    describe('DELETE /prison/prison', function() {
        it('should delete an existing prison successfully', function(done) {
            if (!createdPrisonId) {
                this.skip();
                return done();
            }
            request(app)
                .delete('/prison/prison')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ id: createdPrisonId })
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.equal(1); // 1 row deleted

                    // Verify by trying to get it
                    request(app)
                        .get(`/prison/prison?id=${createdPrisonId}`)
                        .set('Authorization', `Bearer ${authToken}`)
                        .expect(200)
                        .end((err, res) => {
                            if (err) return done(err);
                            expect(res.body.data).to.be.null; // Should not be found
                            done();
                        });
                });
        });

        it('should return 0 if prison ID to delete does not exist', function(done) {
            request(app)
                .delete('/prison/prison')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ id: 99999 }) // Non-existent ID
                .expect(200) // API returns 200 but 0 rows deleted
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.equal(0);
                    done();
                });
        });
    });
});
