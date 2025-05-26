import request from 'supertest';
import { expect } from 'chai';
import app from '../index.js'; // Note the .js extension for local imports
import sqlite3 from 'sqlite3'; // sqlite3.verbose() might need direct import if not default
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url'; // Import fileURLToPath
import { dirname } from 'path'; 

// Get the current file's path from its URL
const __filename = fileURLToPath(import.meta.url);
// Get the directory name from the file path
const __dirname = dirname(__filename);


// Define the path for the test database. Using a separate database for tests
// ensures that development data is not affected.
const TEST_DB_PATH = path.join(__dirname, 'userData_test.db');

// Before all tests, set up the test database
before(function(done) {
    // Delete the test database file if it exists to ensure a clean slate for each test run
    if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
    }

    // Connect to the test database. If the file doesn't exist, it will be created.
    const db = new sqlite3.Database(TEST_DB_PATH, (err) => {
        if (err) {
            console.error('Error opening test database:', err.message);
            return done(err);
        }
        console.log('Connected to the test SQLite database.');

        // Create the 'user' table in the test database
// Inside your 'before' hook, modify the createTableSql:
const createTableSql = `
    CREATE TABLE IF NOT EXISTS user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password TEXT NOT NULL,
        email TEXT NOT NULL,  -- Added email
        role TEXT NOT NULL    -- Added role
    );
`;
        db.run(createTableSql, (err) => {
            if (err) {
                console.error('Error creating user table:', err.message);
                return done(err);
            }
            console.log('User table created or already exists in test database.');
            db.close(() => {
                // Set the environment variable to use the test database
                // This assumes your index.js uses process.env.DB_PATH
                process.env.DB_PATH = TEST_DB_PATH;
                done(); // Signal that setup is complete
            });
        });
    });
});

// After all tests, clean up the test database
after(function(done) {
    // Delete the test database file
    if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
        console.log('Test database deleted.');
    }
    done(); // Signal that cleanup is complete
});

// Describe block for the API tests
describe('User Authentication API', function() {
    // Test suite for the /auth/register endpoint
    describe('POST /auth/user', function() {
it('should register a new user successfully', function(done) {
    request(app)
        .post('/auth/user')
        .send({
            username: "testuser1",
            name: "Test User One",
            password: "password123",
            email: "abc@def.ghi",
            role: "admin",
        })
        .expect(200)
        .end((err, res) => {
            if (err) return done(err);
            // EXPECTATION CHANGE: Assert against res.body.info
            expect(res.body.info).to.equal('Successfully created user.');
            // You can also check other properties if desired:
            expect(res.body.success).to.be.true;
            expect(res.body.data.username).to.equal('testuser1');
            done();
        });
});
// ... (inside your 'POST /auth/user' describe block) ...

it('should return "User already exists" for an existing username', function(done) {
    // First, register a *NEW* user for this specific test's setup
    request(app)
        .post('/auth/user')
        .send({
            username: "existinguser_test", // Unique username for this test's setup
            name: "Existing User Test",
            password: "password123",
            email: "existing_test@def.ghi", // REQUIRED field
            role: "admin" // REQUIRED field
            // No gender and location, as per your instruction
        })
        .expect(200) // Now this setup registration should pass
        .end((err, res) => {
            if (err) {
                console.error("Setup for 'User already exists' failed:", res.body || res.text, err);
                return done(err);
            }
            expect(res.body.info).to.equal('Successfully created user.'); // Verify success message
            expect(res.body.success).to.be.true;

            // Then, try to register the *SAME* user again to trigger the "User already exists" error
            request(app)
                .post('/auth/user')
                .send({
                    username: 'existinguser_test', // Use the same username again
                    name: 'Existing User Test',
                    password: 'password123',
                    email: "existing_test@def.ghi",
                    role: "admin"
                })
                .expect(400) // Expect 400 Bad Request
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.error).to.equal('Email address already in use.');
                    expect(res.body.success).to.be.false;
                    done();
                });
        });
});

        it('should return "Password is too short" if password is less than 6 characters', function(done) {
            request(app)
                .post('/auth/user')
                .send({
                    username: 'shortpassuser',
                    name: 'Short Pass User',
                    password: 'short', // Password less than 6 characters
                    gender: 'Other',
                    location: 'Someplace'
                })
                .expect(400) // Expect a 400 Bad Request status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Password is too short'); // Check the response message
                    done();
                });
        });

        it('should return "Missing required fields" if any field is missing', function(done) {
            request(app)
                .post('/auth/user')
                .send({
                    username: 'incompleteuser',
                    name: 'Incomplete User',
                    password: 'password123',
                    gender: 'Male'
                    // location is missing
                })
                .expect(400) // Expect a 400 Bad Request status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Missing required fields'); // Check the response message
                    done();
                });
        });
    });

    // Test suite for the /auth/login endpoint
    describe('POST /auth/login', function() {
        // Register a user before running login tests
        before(function(done) {
            request(app)
                .post('/auth/user')
                .send({
                    username: 'loginuser',
                    name: 'Login User',
                    password: 'loginpass',
                    gender: 'Male',
                    location: 'Login City'
                })
                .expect(200)
                .end(done);
        });

        it('should login a user successfully with correct credentials', function(done) {
            request(app)
                .post('/auth/login')
                .send({
                    username: 'loginuser',
                    password: 'loginpass'
                })
                .expect(200) // Expect a 200 OK status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Login success!'); // Check the response message
                    done();
                });
        });

        it('should return "Invalid user" for a non-existent username', function(done) {
            request(app)
                .post('/auth/login')
                .send({
                    username: 'nonexistentuser',
                    password: 'anypassword'
                })
                .expect(400) // Expect a 400 Bad Request status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Invalid user'); // Check the response message
                    done();
                });
        });

        it('should return "Invalid password" for an incorrect password', function(done) {
            request(app)
                .post('/auth/login')
                .send({
                    username: 'loginuser',
                    password: 'wrongpassword'
                })
                .expect(400) // Expect a 400 Bad Request status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Invalid password'); // Check the response message
                    done();
                });
        });

        it('should return "Missing required fields" if username or password is missing', function(done) {
            request(app)
                .post('/auth/login')
                .send({
                    username: 'loginuser'
                    // password is missing
                })
                .expect(400) // Expect a 400 Bad Request status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Missing required fields'); // Check the response message
                    done();
                });
        });
    });

    // Test suite for the /auth/change-password endpoint
    describe('PUT /auth/user', function() {
        // Register a user before running change-password tests
        before(function(done) {
            request(app)
                .post('/auth/user')
                .send({
                    username: 'changepassuser',
                    name: 'Change Pass User',
                    password: 'oldpassword',
                    gender: 'Female',
                    location: 'Change City'
                })
                .expect(200)
                .end(done);
        });

        it('should change password successfully with correct old password', function(done) {
            request(app)
                .put('/auth/user')
                .send({
                    username: 'changepassuser',
                    oldPassword: 'oldpassword',
                    newPassword: 'newsecurepassword'
                })
                .expect(200) // Expect a 200 OK status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Password updated'); // Check the response message
                    done();
                });
        });

        it('should return "Invalid current password" for incorrect old password', function(done) {
            request(app)
                .put('/auth/user')
                .send({
                    username: 'changepassuser',
                    oldPassword: 'wrongoldpassword',
                    newPassword: 'anothernewpassword'
                })
                .expect(400) // Expect a 400 Bad Request status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Invalid current password'); // Check the response message
                    done();
                });
        });

        it('should return "Password is too short" if new password is less than 6 characters', function(done) {
            request(app)
                .put('/auth/user')
                .send({
                    username: 'changepassuser',
                    oldPassword: 'newsecurepassword', // Use the updated password from previous test
                    newPassword: 'short' // New password less than 6 characters
                })
                .expect(400) // Expect a 400 Bad Request status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Password is too short'); // Check the response message
                    done();
                });
        });

        it('should return "Missing required fields" if any field is missing', function(done) {
            request(app)
                .put('/auth/user')
                .send({
                    username: 'changepassuser',
                    oldPassword: 'newsecurepassword'
                    // newPassword is missing
                })
                .expect(400) // Expect a 400 Bad Request status code
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.text).to.equal('Missing required fields'); // Check the response message
                    done();
                });
        });
    });
});
