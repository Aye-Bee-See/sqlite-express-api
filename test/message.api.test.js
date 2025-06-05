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
const MESSAGE_TEST_DB_PATH = path.join(__dirname, 'message_test.db');
const USER_DB_PATH = path.join(__dirname, 'message_user_test.db'); // For user authentication
const PRISONER_DB_PATH = path.join(__dirname, 'message_prisoner_test.db'); // For prisoner references
const CHAT_DB_PATH = path.join(__dirname, 'message_chat_test.db'); // For chat references

describe('Messages API', function() {
    let server;
    let messageDb;
    let createdMessageId;
    let authToken;
    let createdUserId;
    let createdPrisonerId;
    let createdChatId;

    // Before all tests, set up the test databases and start the server
    before(function(done) {
        this.timeout(20000); // Increased timeout for multiple DB setups

        // Delete test databases if they exist
        [MESSAGE_TEST_DB_PATH, USER_DB_PATH, PRISONER_DB_PATH, CHAT_DB_PATH].forEach(dbPath => {
            if (fs.existsSync(dbPath)) {
                fs.unlinkSync(dbPath);
            }
        });

        // 1. Connect to the user test database
        const userDb = new sqlite3.Database(USER_DB_PATH, (err) => {
            if (err) {
                console.error('Error opening user test database for messages:', err.message);
                return done(err);
            }
            console.log('Connected to the user test SQLite database for messages.');
            
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
                    console.error('Error creating user table for message tests:', err.message);
                    return done(err);
                }
                console.log('User table created or already exists in user test database for messages.');
                
                // 2. Connect to the prisoner test database
                const prisonerDb = new sqlite3.Database(PRISONER_DB_PATH, (err) => {
                    if (err) {
                        console.error('Error opening prisoner test database for messages:', err.message);
                        return done(err);
                    }
                    console.log('Connected to the prisoner test SQLite database for messages.');
                    
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
                            console.error('Error creating prisoner table for message tests:', err.message);
                            return done(err);
                        }
                        console.log('Prisoner table created or already exists in prisoner test database for messages.');
                        
                        // 3. Connect to the chat test database
                        const chatDb = new sqlite3.Database(CHAT_DB_PATH, (err) => {
                            if (err) {
                                console.error('Error opening chat test database for messages:', err.message);
                                return done(err);
                            }
                            console.log('Connected to the chat test SQLite database for messages.');
                            
                            const createChatTableSql = `
                                CREATE TABLE IF NOT EXISTS chat (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    user INTEGER NOT NULL,
                                    prisoner INTEGER NOT NULL
                                );
                            `;
                            
                            chatDb.run(createChatTableSql, (err) => {
                                if (err) {
                                    console.error('Error creating chat table for message tests:', err.message);
                                    return done(err);
                                }
                                console.log('Chat table created or already exists in chat test database for messages.');
                                
                                // 4. Connect to the message test database
                                messageDb = new sqlite3.Database(MESSAGE_TEST_DB_PATH, (err) => {
                                    if (err) {
                                        console.error('Error opening message test database:', err.message);
                                        return done(err);
                                    }
                                    console.log('Connected to the message test SQLite database.');
                                    
                                    const createMessageTableSql = `
                                        CREATE TABLE IF NOT EXISTS message (
                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                            chat INTEGER NOT NULL,
                                            messageText TEXT,
                                            sender TEXT NOT NULL,
                                            prisoner INTEGER NOT NULL,
                                            user INTEGER NOT NULL
                                        );
                                    `;
                                    
                                    messageDb.run(createMessageTableSql, (err) => {
                                        if (err) {
                                            console.error('Error creating message table:', err.message);
                                            return done(err);
                                        }
                                        console.log('Message table created or already exists in message test database.');
                                        
                                        // Set the NODE_ENV to test
                                        process.env.NODE_ENV = 'test';
                                        process.env.TEST_MESSAGE_DB_PATH = MESSAGE_TEST_DB_PATH;
                                        process.env.TEST_USER_DB_PATH = USER_DB_PATH;
                                        process.env.TEST_PRISONER_DB_PATH = PRISONER_DB_PATH;
                                        process.env.TEST_CHAT_DB_PATH = CHAT_DB_PATH;
                                        
                                        // Start the server
                                        server = app.listen(4007, () => {
                                            console.log('Test server started on port 4007 for Message API tests.');
                                            
                                            // Register a user for authentication
                                            request(app)
                                                .post('/auth/user')
                                                .send({
                                                    username: 'testmessageuser',
                                                    name: 'Test Message User',
                                                    password: 'password123',
                                                    email: 'messagetest@example.com',
                                                    role: 'admin'
                                                })
                                                .end((err, res) => {
                                                    if (err) return done(err);
                                                    
                                                    // Make sure res.body.data exists and has id
                                                    if (!res.body || !res.body.data || !res.body.data.id) {
                                                        return done(new Error('Failed to get user ID from response: ' + JSON.stringify(res.body)));
                                                    }
                                                    
                                                    createdUserId = res.body.data.id;
                                                    
                                                    // Login to get auth token first
                                                    request(app)
                                                        .post('/auth/login')
                                                        .send({
                                                            username: 'testmessageuser',
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
                                                                return done(new Error('Failed to get prisoner ID from response: ' + JSON.stringify(res.body)));
                                                            }
                                                            
                                                            createdPrisonerId = res.body.data.id;
                                                            
                                                            // Auth token already obtained
                                                                    
                                                                    // Create a chat first, as messages need a chat to belong to
                                                                    request(app)
                                                                        .post('/chat/chat')
                                                                        .set('Authorization', `Bearer ${authToken}`)
                                                                        .send({
                                                                            user: createdUserId,
                                                                            prisoner: createdPrisonerId
                                                                        })
                                                                        .end((err, res) => {
                                                                            if (err) return done(err);
                                                                            
                                                                            // Make sure res.body.data exists and has id
                                                                            if (!res.body || !res.body.data || !res.body.data.id) {
                                                                                return done(new Error('Failed to get chat ID from response: ' + JSON.stringify(res.body)));
                                                                            }
                                                                            
                                                                            createdChatId = res.body.data.id;
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
            });
        });
    });

    // After all tests, clean up
    after(function(done) {
        this.timeout(10000);
        
        // Close server and cleanup database files
        if (server) {
            server.close(() => {
                console.log('Test server for   closed.');
                
                // Delete test database files
                [MESSAGE_TEST_DB_PATH, USER_DB_PATH, PRISONER_DB_PATH, CHAT_DB_PATH].forEach(dbPath => {
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

    // Test POST /messaging/message - Create a new message
    describe('POST /messaging/message', function() {
        it('should create a new message successfully', function(done) {
            request(app)
                .post('/messaging/message')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    chat: createdChatId,
                    messageText: 'This is a test message',
                    sender: 'user',
                    prisoner: createdPrisonerId,
                    user: createdUserId
                })
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    
                    expect(res.body.success).to.equal(true);
                    expect(res.body.data).to.have.property('id');
                    createdMessageId = res.body.data.id;
                    done();
                });
        });

        it('should return error if sender is missing', function(done) {
            request(app)
                .post('/messaging/message')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    chat: createdChatId,
                    messageText: 'This is a test message',
                    prisoner: createdPrisonerId,
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

    // Test GET /messaging/messages - Get all messages
    describe('GET /messaging/messages', function() {
        it('should get all messages', function(done) {
            request(app)
                .get('/messaging/messages')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    
                    expect(res.body.success).to.equal(true);
                    expect(res.body.data).to.be.an('array');
                    expect(res.body.data.length).to.be.at.least(1);
                    done();
                });
        });
    });

    //SHOULDFAIL - Errors with Message.getMessageByID is not a function
    // Test GET /messaging/message?id=:id - Get a specific message
    describe('GET /messaging/message', function() {
        it('should get a specific message by id', function(done) {
            request(app)
                .get(`/messaging/message?id=${createdMessageId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    
                    expect(res.body.success).to.equal(true);
                    expect(res.body.data).to.be.an('array');
                    expect(res.body.data.length).to.equal(1);
                    expect(res.body.data[0].id).to.equal(createdMessageId);
                    done();
                });
        });

        //SHOULDFAIL - Errors with "modelsService is not defined"
        it('should get messages by chat id', function(done) {
            request(app)
                .get(`/messaging/messages?chat=${createdChatId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    
                    expect(res.body.success).to.equal(true);
                    expect(res.body.data).to.be.an('array');
                    expect(res.body.data.length).to.be.at.least(1);
                    done();
                });
        });
    });

    // Test PUT /messaging/message - Update a message
    describe('PUT /messaging/message', function() {
        it('should update a message successfully', function(done) {
            request(app)
                .put('/messaging/message')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    id: createdMessageId,
                    messageText: 'This is an updated test message'
                })
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    
                    expect(res.body.success).to.equal(true);
                    
                    // Verify the message was updated by getting it
                    request(app)
                        .get(`/messaging/message?id=${createdMessageId}`)
                        .set('Authorization', `Bearer ${authToken}`)
                        .end((err, res) => {
                            if (err) return done(err);
                            
                            expect(res.body.data[0].messageText).to.equal('This is an updated test message');
                            done();
                        });
                });
        });

        it('should return error if message id is missing', function(done) {
            request(app)
                .put('/messaging/message')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    messageText: 'This is an updated test message'
                })
                .expect(400)
                .end((err, res) => {
                    if (err) return done(err);
                    
                    expect(res.body.success).to.equal(false);
                    done();
                });
        });
    });

    // Test DELETE /messaging/message - Delete a message
    describe('DELETE /messaging/message', function() {
        it('should delete a message successfully', function(done) {
            request(app)
                .delete('/messaging/message')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    id: createdMessageId
                })
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    
                    expect(res.body.success).to.equal(true);
                    //SHOULDFAIL - Errors with "modelsService is not defined"
                    // Verify the message was deleted by trying to get it
                    request(app)
                        .get(`/messaging/message?id=${createdMessageId}`)
                        .set('Authorization', `Bearer ${authToken}`)
                        .end((err, res) => {
                            if (err) return done(err);
                            
                            expect(res.body.data).to.be.an('array');
                            expect(res.body.data.length).to.equal(0);
                            done();
                        });
                });
        });

        it('should return error if message id is missing', function(done) {
            request(app)
                .delete('/messaging/message')
                .set('Authorization', `Bearer ${authToken}`)
                .send({})
                .expect(400)
                .end((err, res) => {
                    if (err) return done(err);
                    
                    expect(res.body.success).to.equal(false);
                    done();
                });
        });
    });
});



