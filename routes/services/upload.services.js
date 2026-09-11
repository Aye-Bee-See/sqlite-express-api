import multer from 'multer';
import ValidationError from '#services/ValidationError.js';
import { uploadMaxBytes } from '#constants';
import { ALLOWED_MIME_TYPES } from '#services/files.js';

const parser = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: uploadMaxBytes, files: 1 },
	fileFilter(req, file, done) {
		if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
			return done(
				new ValidationError(
					'File type ' +
						file.mimetype +
						' is not accepted; use ' +
						ALLOWED_MIME_TYPES.join(', ') +
						'.'
				)
			);
		}
		done(null, true);
	}
});

/**
 * Middleware: parse one multipart file field into req.file (in memory) and
 * the other fields into req.body. Multer's own errors are rendered as
 * validation errors so clients get the usual { errors: [...] } shape.
 * @param {string} field form field name
 */
export function uploadSingle(field) {
	const handler = parser.single(field);
	return (req, res, next) => {
		handler(req, res, (err) => {
			if (!err) {
				return next();
			}
			if (err instanceof multer.MulterError) {
				const message =
					err.code === 'LIMIT_FILE_SIZE'
						? 'File is larger than ' + uploadMaxBytes + ' bytes.'
						: err.code === 'LIMIT_UNEXPECTED_FILE'
							? 'Send exactly one file in the "' + field + '" field.'
							: err.message;
				return next(new ValidationError(message));
			}
			next(err);
		});
	};
}
