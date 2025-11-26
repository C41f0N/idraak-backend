import multer from 'multer';
import path from 'path';

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

// Multer upload configurations with memory storage (for Supabase)
export const uploadIssueImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: imageFilter
}).single('display_picture');

// Combined upload with memory storage for Supabase
export const uploadIssueFiles = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per file
    fileFilter: (req, file, cb) => {
        // No file type restrictions - accept all file types
        cb(null, true);
    }
}).fields([
    { name: 'display_picture', maxCount: 1 },
    { name: 'attachments', maxCount: 5 }
]);
