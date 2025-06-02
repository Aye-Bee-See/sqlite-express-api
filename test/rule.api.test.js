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
const RULE_TEST_DB_PATH = path.join(__dirname, 'rule_test.db');
const USER_DB_PATH = path.join(__dirname, 'rule_user_test.db'); // Separate user DB for these tests
const PRISON_TEST_DB_PATH = path.join(__dirname, 'rule_prison_test.db'); // If rules are linked to prisons

describe('Rules API', function() {
    let server;
    let ruleDb;
    let createdRuleId;
    let authToken;
    let createdUserId;
    let createdPrisonId; // For tests involving prison-specific rules

    // Before all tests, set up the test databases and start the server
    before(function(done) {
        this.timeout(30000); // Increased timeout for multiple DB setups

        // Delete test databases if they exist
        [RULE_TEST_DB_PATH, USER_DB_PATH, PRISON_TEST_DB_PATH].forEach(dbPath => {
            if (fs.existsSync(dbPath)) {
                fs.unlinkSync(dbPath);
            }
        });

        // 1. Connect to the user test database and set it up
        const userDbConnection = new sqlite3.Database(USER_DB_PATH, (err) => {
            if (err) return done(err);
            console.log('Connected to the user test SQLite database for rules.');
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
                if (err) { userDbConnection.close(); return done(err); }
                console.log('User table created for rule tests.');
                userDbConnection.close(() => {
                    // 2. Connect to the prison test database (if needed for rule association)
                    const prisonDbConnection = new sqlite3.Database(PRISON_TEST_DB_PATH, (err) => {
                        if (err) return done(err);
                        console.log('Connected to the prison test SQLite database for rules.');
                        const createPrisonTableSql = `
                            CREATE TABLE IF NOT EXISTS prison (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                prisonName TEXT NOT NULL,
                                address TEXT NOT NULL,
                                deleted INTEGER DEFAULT 0
                            );
                        `;
                        prisonDbConnection.run(createPrisonTableSql, (err) => {
                            if (err) { prisonDbConnection.close(); return done(err); }
                            console.log('Prison table created for rule tests.');
                            // Seed a dummy prison for tests that require a prisonId
                            const insertPrisonSql = `INSERT INTO prison (prisonName, address) VALUES (?, ?)`;
                            prisonDbConnection.run(insertPrisonSql, ['Test Prison for Rules', JSON.stringify({street: '123 Law St'})], function(err) {
                                if (err) { prisonDbConnection.close(); return done(err); }
                                createdPrisonId = this.lastID;
                                prisonDbConnection.close(() => {
                                    // 3. Connect to the rule test database
                                    ruleDb = new sqlite3.Database(RULE_TEST_DB_PATH, (err) => {
                                        if (err) return done(err);
                                        console.log('Connected to the rule test SQLite database.');
                                        const createRuleTableSql = `
                                            CREATE TABLE IF NOT EXISTS rule (
                                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                title TEXT,
                                                description TEXT,
                                                prisonId INTEGER, -- Assuming rules can be linked to prisons
                                                FOREIGN KEY (prisonId) REFERENCES prison(id)
                                            );
                                        `;
                                        ruleDb.run(createRuleTableSql, (err) => {
                                            if (err) { ruleDb.close(); return done(err); }
                                            console.log('Rule table created.');
                                            ruleDb.close(() => {
                                                process.env.DB_PATH = RULE_TEST_DB_PATH;
                                                process.env.USER_DB_PATH = USER_DB_PATH;
                                                process.env.PRISON_DB_PATH = PRISON_TEST_DB_PATH; // For rule model to potentially access

                                                request(app)
                                                    .post('/auth/user')
                                                    .send({
                                                        username: 'ruletestuser',
                                                        name: 'Rule Test User',
                                                        password: 'testpassword123',
                                                        email: 'ruletest@example.com',
                                                        role: 'admin'
                                                    })
                                                    .expect(200)
                                                    .end((err, res) => {
                                                        if (err) return done(err);
                                                        createdUserId = res.body.data.id;
                                                        request(app)
                                                            .post('/auth/login')
                                                            .send({
                                                                username: 'ruletestuser',
                                                                password: 'testpassword123'
                                                            })
                                                            .expect(200)
                                                            .end((err, res) => {
                                                                if (err) return done(err);
                                                                authToken = res.body.data.token.token;
                                                                server = app.listen(4005, () => {
                                                                    console.log('Test server started on port 4005 for Rule API tests.');
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
        this.timeout(15000);
        const cleanupTasks = [];
        [RULE_TEST_DB_PATH, USER_DB_PATH, PRISON_TEST_DB_PATH].forEach(dbPath => {
            cleanupTasks.push(cb => {
                if (fs.existsSync(dbPath)) {
                    fs.unlink(dbPath, err => {
                        if (err) console.error(`Error deleting ${dbPath}:`, err.message);
                        else console.log(`${dbPath} deleted.`);
                        cb();
                    });
                } else cb();
            });
        });

        let tasksCompleted = 0;
        const totalTasks = cleanupTasks.length + (server ? 1 : 0);
        function checkDone() {
            tasksCompleted++;
            if (tasksCompleted >= totalTasks) done();
        }
        cleanupTasks.forEach(task => task(checkDone));
        if (server) server.close(err => {
            if(err) console.error('Error closing server for rule tests:', err);
            else console.log('Test server for rules closed.');
            checkDone();
        });
        else if (totalTasks === 0) done();
    });

    // Test POST /rule/rule - Create a new rule
    describe('POST /rule/rule', function() {
        it('should create a new rule successfully', function(done) {
            const newRule = {
                title: 'No Loud Music After 10 PM',
                description: 'Ensure all music is turned off or headphones are used after 10 PM.',
                // prisonId: createdPrisonId // Optionally associate with a prison
            };
            request(app)
                .post('/rule/rule')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newRule)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.have.property('id');
                    expect(res.body.data.title).to.equal(newRule.title);
                    expect(res.body.data.description).to.equal(newRule.description);
                    createdRuleId = res.body.data.id;
                    done();
                });
        });

        it('should fail if trying to create rule with no title', function(done) {
            const newRule = {
                description: 'Mandatory quiet hours during study periods.',
            };
            request(app)
                .post('/rule/rule')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newRule)
                .expect(400)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.false;
                    expect(res.body.errors).to.be.an('array');
                    expect(res.body.errors).to.include('Rule.title cannot be null');
                    done();
                });
        });
    });

    // Test GET /rule/rules - Get all rules
    describe('GET /rule/rules', function() {
        it('should return all rules', function(done) {
            request(app)
                .get('/rule/rules?page_size=-1')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.be.an('array');
                    if (createdRuleId) {
                        const found = res.body.data.some(rule => rule.id === createdRuleId);
                        expect(found).to.be.true;
                    }
                    done();
                });
        });
    });

    // Test GET /rule/rules?prison=:prisonId - Get rules by prison
    describe('GET /rule/rules?prison=:prisonId', function() {
        let ruleForPrisonId;
        before(function(done) {
            // Create a specific rule associated with the test prison
            const ruleForPrison = {
                title: 'Prison Specific Rule',
                description: 'This rule only applies to Test Prison for Rules.',
                prisonId: createdPrisonId
            };
            ruleDb = new sqlite3.Database(RULE_TEST_DB_PATH); // Reopen for this operation
            const stmt = ruleDb.prepare("INSERT INTO rule (title, description, prisonId) VALUES (?, ?, ?)");
            stmt.run(ruleForPrison.title, ruleForPrison.description, ruleForPrison.prisonId, function(err) {
                if (err) { ruleDb.close(); return done(err); }
                ruleForPrisonId = this.lastID;
                stmt.finalize(err => {
                    ruleDb.close(errClose => done(err || errClose));
                });
            });
        });

        it('should return rules filtered by prisonId', function(done) {
            if (!createdPrisonId || !ruleForPrisonId) this.skip();
            request(app)
                .get(`/rule/rules?Prison=${createdPrisonId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.be.an('array');
                    const foundRule = res.body.data.some(rule => rule.id === ruleForPrisonId && rule.prisonId === createdPrisonId);
                    expect(foundRule).to.be.true;
                    // Ensure other rules (not linked to this prison) are not present if applicable
                    const foundGeneralRule = res.body.data.some(rule => rule.id === createdRuleId && !rule.prisonId);
                    expect(foundGeneralRule).to.be.false; // Assuming createdRuleId was not linked to this prison
                    done();
                });
        });

        it('should return empty array if prisonId has no rules', function(done) {
            request(app)
                .get('/rule/rules?prison=99999') // Non-existent or no-rules prisonId
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.be.an('array').that.is.empty;
                    done();
                });
        });
    });

    // Test GET /rule/rule?id=:id - Get a single rule
    describe('GET /rule/rule?id=:id', function() {
        it('should return a single rule if ID is valid and exists', function(done) {
            if (!createdRuleId) this.skip();
            request(app)
                .get(`/rule/rule?id=${createdRuleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.have.property('id', createdRuleId);
                    expect(res.body.data.title).to.equal('No Loud Music After 10 PM');
                    done();
                });
        });

        it('should return null data if rule ID does not exist', function(done) {
            request(app)
                .get('/rule/rule?id=99999')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.be.null;
                    done();
                });
        });

        it('should return error if ID is not provided', function(done) {
            request(app)
                .get('/rule/rule') // No ID
                .set('Authorization', `Bearer ${authToken}`)
                .expect(400) 
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.false;
                    done();
                });
        });
    });

    // Test PUT /rule/rule - Update an existing rule
    describe('PUT /rule/rule', function() {
        it('should update an existing rule successfully', function(done) {
            if (!createdRuleId) this.skip();
            const updatedRule = {
                id: createdRuleId,
                title: 'Quiet Hours Policy',
                description: 'Strict quiet hours are enforced from 10 PM to 6 AM daily.',
                // prisonId: createdPrisonId // Optionally update prison association
            };
            request(app)
                .put('/rule/rule')
                .set('Authorization', `Bearer ${authToken}`)
                .send(updatedRule)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data.updatedRows).to.be.an('array').that.includes(1);
                    expect(res.body.data.newRule.title).to.equal(updatedRule.title);
                    expect(res.body.data.newRule.description).to.equal(updatedRule.description);
                    done();
                });
        });

        it('should return 0 updatedRows if rule ID does not exist', function(done) {
            const updatedRule = {
                id: 99999,
                title: 'Non Existent Rule',
                description: 'This rule should not be found.'
            };
            request(app)
                .put('/rule/rule')
                .set('Authorization', `Bearer ${authToken}`)
                .send(updatedRule)
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data.updatedRows).to.be.an('array').that.includes(0);
                    done();
                });
        });
    });

    // Test DELETE /rule/rule - Delete a rule
    describe('DELETE /rule/rule', function() {
        it('should delete an existing rule successfully', function(done) {
            if (!createdRuleId) this.skip();
            request(app)
                .delete('/rule/rule')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ id: createdRuleId })
                .expect(200)
                .end((err, res) => {
                    if (err) return done(err);
                    expect(res.body.success).to.be.true;
                    expect(res.body.data).to.equal(1);

                    request(app)
                        .get(`/rule/rule?id=${createdRuleId}`)
                        .set('Authorization', `Bearer ${authToken}`)
                        .expect(200)
                        .end((err, res) => {
                            if (err) return done(err);
                            expect(res.body.data).to.be.null;
                            done();
                        });
                });
        });

        it('should return 0 if rule ID to delete does not exist', function(done) {
            request(app)
                .delete('/rule/rule')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ id: 99999 })
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
