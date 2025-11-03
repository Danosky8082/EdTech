const multer = require('multer');
const path = require('path');

// File filter function for general files
const fileFilter = (req, file, cb) => {
    try {
        const allowedFileTypes = /pdf|doc|docx|txt|zip|rar|jpg|jpeg|png|gif|ppt|pptx|xls|xlsx|mp4|avi|mov|wmv|flv|mkv|webm|mp3|wav|ogg/;
        const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedFileTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            // Create a custom error that can be handled
            const error = new Error('File type not supported! Please upload documents, videos, audio, or archive files.');
            error.status = 400;
            error.code = 'UNSUPPORTED_FILE_TYPE';
            return cb(error, false);
        }
    } catch (error) {
        cb(error, false);
    }
};

// File filter function for exam questions (CSV and JSON only)
const examQuestionsFileFilter = (req, file, cb) => {
    try {
        const allowedFileTypes = /csv|json/;
        const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
        
        // Allow CSV and JSON MIME types
        const allowedMimeTypes = [
            'text/csv',
            'application/csv',
            'application/json',
            'text/json',
            'application/vnd.ms-excel' // Some CSV files may have this MIME type
        ];

        const mimetype = allowedMimeTypes.includes(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            const error = new Error('Only CSV and JSON files are allowed for exam questions!');
            error.status = 400;
            error.code = 'UNSUPPORTED_FILE_TYPE';
            return cb(error, false);
        }
    } catch (error) {
        cb(error, false);
    }
};

// Configure storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

// Create upload instance for general files
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

// Create upload instance for exam questions (CSV and JSON only)
const uploadExamQuestions = multer({
    storage: storage,
    fileFilter: examQuestionsFileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit for exam questions
    }
});

// Create dedicated upload for materials with larger size limit
const uploadMaterial = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedFileTypes = /pdf|doc|docx|txt|zip|rar|ppt|pptx|xls|xlsx|mp4|avi|mov|wmv|flv|mkv|webm|mp3|wav|ogg/;
        const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedFileTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            const error = new Error('File type not supported! Please upload documents, videos, audio, or archive files.');
            error.status = 400;
            error.code = 'UNSUPPORTED_FILE_TYPE';
            return cb(error, false);
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit for materials
    }
});

// Create dedicated upload for profile pictures
const uploadProfile = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedFileTypes = /jpg|jpeg|png|gif|webp/;
        const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedFileTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            const error = new Error('File type not supported! Please upload JPG, PNG, or GIF images.');
            error.status = 400;
            error.code = 'UNSUPPORTED_FILE_TYPE';
            return cb(error, false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit for profile pictures
    }
});

// Create a wrapper to handle errors properly
const handleUploadError = (uploadMiddleware) => {
    return (req, res, next) => {
        uploadMiddleware(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({
                        success: false,
                        message: 'File too large. Maximum size is 100MB.'
                    });
                }
                if (err.code === 'UNSUPPORTED_FILE_TYPE') {
                    return res.status(400).json({
                        success: false,
                        message: err.message
                    });
                }
                if (err instanceof multer.MulterError) {
                    return res.status(400).json({
                        success: false,
                        message: 'File upload error: ' + err.message
                    });
                }
                // For other errors
                return res.status(500).json({
                    success: false,
                    message: 'File upload failed: ' + err.message
                });
            }
            next();
        });
    };
};

// Special error handler for exam questions with specific file size message
const handleExamQuestionsUploadError = (uploadMiddleware) => {
    return (req, res, next) => {
        uploadMiddleware(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({
                        success: false,
                        message: 'File too large. Maximum size for exam questions is 5MB.'
                    });
                }
                if (err.code === 'UNSUPPORTED_FILE_TYPE') {
                    return res.status(400).json({
                        success: false,
                        message: err.message
                    });
                }
                if (err instanceof multer.MulterError) {
                    return res.status(400).json({
                        success: false,
                        message: 'File upload error: ' + err.message
                    });
                }
                // For other errors
                return res.status(500).json({
                    success: false,
                    message: 'File upload failed: ' + err.message
                });
            }
            next();
        });
    };
};

// Export wrapped upload middleware
module.exports = {
    upload: upload,
    uploadMaterial: uploadMaterial,
    uploadProfile: uploadProfile,
    uploadExamQuestions: uploadExamQuestions, // Added exam questions upload
    handleUploadError,
    handleExamQuestionsUploadError,
    
    // Single upload handlers
    uploadSingle: (fieldName) => handleUploadError(upload.single(fieldName)),
    uploadMaterialSingle: (fieldName) => handleUploadError(uploadMaterial.single(fieldName)),
    uploadProfileSingle: (fieldName) => handleUploadError(uploadProfile.single(fieldName)),
    uploadExamQuestionsSingle: (fieldName) => handleExamQuestionsUploadError(uploadExamQuestions.single(fieldName)), // For exam questions
    
    // Array and fields upload handlers
    uploadArray: (fieldName, maxCount) => handleUploadError(upload.array(fieldName, maxCount)),
    uploadFields: (fields) => handleUploadError(upload.fields(fields))
};