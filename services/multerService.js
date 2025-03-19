import multer from 'multer';
import fs from 'fs';

export function getMulterUpload(destination, property) {
    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
          console.log(req);
            if (!fs.existsSync(destination)) {
                fs.mkdirSync(destination, { recursive: true });
            }
            cb(null, destination);
        },
        filename: function (req, file, cb) {
            cb(null, `${Date.now()}-${req.body[property]}`);
        }
    });

    return multer({ storage: storage });
}
