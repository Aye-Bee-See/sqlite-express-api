import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the app or create a minimal test setup
import router from './routes/router.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/', router);

describe('Avatar Upload System', function () {
	let authToken;
	let userId;

	before(async function () {
		// First create a user for testing
		const userResponse = await request(app).post('/auth/user').send({
			username: 'avatartest',
			email: 'avatar@test.com',
			password: 'password123',
			name: 'Avatar Test User',
			role: 'user'
		});

		if (userResponse.status === 200) {
			userId = userResponse.body.data.id;

			// Login to get token
			const loginResponse = await request(app).post('/auth/login').send({
				username: 'avatartest',
				password: 'password123'
			});

			if (loginResponse.status === 200) {
				authToken = loginResponse.body.data.token.token;
			}
		}
	});

	it('should upload avatar file successfully', function (done) {
		const testImagePath = path.join(__dirname, 'test-image.png');

		// Create a simple test image file
		const testImageBuffer = Buffer.from('fake-image-data');
		fs.writeFileSync(testImagePath, testImageBuffer);

		request(app)
			.post('/user/uploadAvi')
			.set('Authorization', `Bearer ${authToken}`)
			.field('userId', userId)
			.attach('avatar', testImagePath)
			.expect(200)
			.end((err, res) => {
				// Clean up test file
				if (fs.existsSync(testImagePath)) {
					fs.unlinkSync(testImagePath);
				}

				if (err) return done(err);

				console.log('Avatar upload response:', res.body);

				// Verify response structure
				expect(res.body.success).to.be.true;
				expect(res.body.data.message).to.equal('Avatar uploaded successfully');
				expect(res.body.data.user).to.have.property('avatar');
				expect(res.body.data.avatar).to.have.property('path');

				done();
			});
	});

	it('should return user with avatar path in getOne', function (done) {
		request(app)
			.get(`/user/user?id=${userId}`)
			.set('Authorization', `Bearer ${authToken}`)
			.expect(200)
			.end((err, res) => {
				if (err) return done(err);

				console.log('User data with avatar:', res.body);

				// Verify avatar is included in user data
				expect(res.body.success).to.be.true;
				expect(res.body.data).to.have.property('avatar');

				done();
			});
	});

	after(function () {
		// Clean up uploaded files
		const uploadDir = path.join(__dirname, 'uploads/avatars/users/');
		if (fs.existsSync(uploadDir)) {
			const files = fs.readdirSync(uploadDir);
			files.forEach((file) => {
				if (file.includes('test')) {
					fs.unlinkSync(path.join(uploadDir, file));
				}
			});
		}
	});
});
