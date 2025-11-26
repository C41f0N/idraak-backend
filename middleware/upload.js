import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
const issuesDir = path.join(uploadsDir, 'issues');
const attachmentsDir = path.join(uploadsDir, 'attachments');
const profileDir = path.join(uploadsDir, 'profile_pictures');

[uploadsDir, issuesDir, attachmentsDir, profileDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configure storage for issue display pictures
const issueStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, issuesDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'issue-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Configure storage for attachments
const attachmentStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, attachmentsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'attachment-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// File filter to accept images
const imageFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files are allowed for display pictures'));
    }
};

// File filter for attachments (images, PDFs, documents)
const attachmentFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (extname) {
        return cb(null, true);
    } else {
        cb(new Error('File type not allowed'));
    }
};

// Multer upload configurations
export const uploadIssueImage = multer({
    storage: issueStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    // fileFilter: imageFilter
}).single('display_picture');

// Multer config for profile pictures (separate folder)
export const uploadProfilePicture = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, profileDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    // fileFilter: imageFilter
}).fields([
    { name: 'profile_picture', maxCount: 1 },
    { name: 'display_picture', maxCount: 1 }
]);

// Combined upload with custom storage per field
export const uploadIssueFiles = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            // Display picture goes to issues folder, attachments go to attachments folder
            if (file.fieldname === 'display_picture') {
                cb(null, issuesDir);
            } else {
                cb(null, attachmentsDir);
            }
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            if (file.fieldname === 'display_picture') {
                cb(null, 'issue-' + uniqueSuffix + path.extname(file.originalname));
            } else {
                cb(null, 'attachment-' + uniqueSuffix + path.extname(file.originalname));
            }
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per file
    fileFilter: (req, file, cb) => {
        // No file type restrictions - accept all file types
        cb(null, true);
    }
}).fields([
    { name: 'display_picture', maxCount: 1 },
    { name: 'attachments', maxCount: 5 }
]);
