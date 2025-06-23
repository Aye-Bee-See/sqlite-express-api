import multer from 'multer';
import fs from 'fs';
import path from 'path';

export function getMulterUpload(destination) {
	const storage = multer.diskStorage({
		destination: function (req, file, cb) {
			if (!fs.existsSync(destination)) {
				fs.mkdirSync(destination, { recursive: true });
			}
			cb(null, destination);
		},
		filename: function (req, file, cb) {
			// Save with a temporary name
			cb(null, `${Date.now()}-temp-${file.originalname}`);
		}
	});

	return multer({ storage: storage });
}

export function renameFile(oldPath, newPath) {
	fs.rename(oldPath, newPath, (err) => {
		if (err) {
			console.error('Error renaming file:', err);
		}
	});
}
