import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure unit tests for the error classes and the final error middleware.
// No database and no server involved.
const { HttpError, NotFoundError } = await import('../services/HttpError.js');
const { default: ValidationError } = await import('../services/ValidationError.js');
const { default: ErrorService } = await import('../routes/services/error.services.js');

function fakeRes() {
	const r = {
		headersSent: false,
		code: null,
		body: null,
		status(c) {
			r.code = c;
			return r;
		},
		json(b) {
			r.body = b;
			return r;
		}
	};
	return r;
}

test('HttpError.statusOf maps errors to statuses', () => {
	assert.equal(HttpError.statusOf(null), 500);
	assert.equal(HttpError.statusOf(new Error('plain')), 500);
	assert.equal(HttpError.statusOf(new HttpError(418, 'teapot')), 418);
	assert.equal(HttpError.statusOf(new NotFoundError()), 404);
	assert.equal(HttpError.statusOf(Object.assign(new Error(), { statusCode: 429 })), 429);
	assert.equal(
		HttpError.statusOf(Object.assign(new Error(), { name: 'SequelizeUniqueConstraintError' })),
		400
	);
	assert.equal(
		HttpError.statusOf(Object.assign(new Error(), { name: 'SequelizeForeignKeyConstraintError' })),
		400
	);
	assert.equal(HttpError.statusOf(new ValidationError('x')), 400);
});

test('NotFoundError carries name, status, and message', () => {
	const err = new NotFoundError('Prison 7 not found');
	assert.equal(err.name, 'NotFoundError');
	assert.equal(err.status, 404);
	assert.equal(err.message, 'Prison 7 not found');
	assert.ok(err instanceof HttpError);
});

test("ValidationError.messagesFrom handles ours, Sequelize's, and others", () => {
	assert.deepEqual(ValidationError.messagesFrom(new ValidationError(['a', 'b'])), ['a', 'b']);
	assert.deepEqual(ValidationError.messagesFrom(new ValidationError('single')), ['single']);
	const sequelizeLike = Object.assign(new Error(), {
		name: 'SequelizeValidationError',
		errors: [{ message: 'field bad' }]
	});
	assert.deepEqual(ValidationError.messagesFrom(sequelizeLike), ['field bad']);
	assert.equal(ValidationError.messagesFrom(new Error('nope')), null);
	assert.equal(ValidationError.messagesFrom(null), null);
});

test('ErrorService renders validation errors in the shared shape', () => {
	const res = fakeRes();
	ErrorService.handler(
		new ValidationError(['page must be a positive integer.']),
		{},
		res,
		() => {}
	);
	assert.equal(res.code, 400);
	assert.deepEqual(res.body, { success: false, errors: ['page must be a positive integer.'] });
});

test('ErrorService renders status-carrying errors with their message', () => {
	const res = fakeRes();
	ErrorService.handler(new NotFoundError('Cannot GET /nope'), {}, res, () => {});
	assert.equal(res.code, 404);
	assert.deepEqual(res.body, {
		success: false,
		name: 'NotFoundError',
		info: 'Cannot GET /nope',
		status: 404
	});
});

test('ErrorService hides internal fault details outside development and logs them', () => {
	const original = console.error;
	let logged = 0;
	console.error = () => {
		logged += 1;
	};
	try {
		delete process.env.NODE_ENV;
		const res = fakeRes();
		ErrorService.handler(new TypeError('boom internal'), {}, res, () => {});
		assert.equal(res.code, 500);
		assert.deepEqual(res.body, {
			success: false,
			name: 'TypeError',
			info: 'Internal Server Error',
			status: 500
		});
		assert.equal(logged, 1);

		process.env.NODE_ENV = 'development';
		const dev = fakeRes();
		ErrorService.handler(new TypeError('boom internal'), {}, dev, () => {});
		assert.equal(dev.code, 500);
		assert.equal(dev.body.info, 'boom internal');
		assert.equal(typeof dev.body.stack, 'string');
	} finally {
		console.error = original;
		delete process.env.NODE_ENV;
	}
});

test('ErrorService delegates when headers were already sent', () => {
	const res = fakeRes();
	res.headersSent = true;
	let delegated = false;
	ErrorService.handler(new Error('late'), {}, res, () => {
		delegated = true;
	});
	assert.equal(delegated, true);
	assert.equal(res.body, null);
});
