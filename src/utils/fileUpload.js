const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { put } = require('@vercel/blob');   // <-- Correct CommonJS import

// ============================================================
// 1. Use memory storage so we can get the file buffer
// ============================================================
const storage = multer.memoryStorage();

// ============================================================
// 2. File filters (unchanged)
// ============================================================
const fileFilter = (req, file, cb) => {
  try {
    const allowedFileTypes = /pdf|doc|docx|txt|zip|rar|jpg|jpeg|png|gif|ppt|pptx|xls|xlsx|mp4|avi|mov|wmv|flv|mkv|webm|mp3|wav|ogg/;
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
  } catch (error) {
    cb(error, false);
  }
};

const examQuestionsFileFilter = (req, file, cb) => {
  try {
    const allowedFileTypes = /csv|json/;
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
    const allowedMimeTypes = ['text/csv', 'application/csv', 'application/json', 'text/json', 'application/vnd.ms-excel'];
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

const profileFileFilter = (req, file, cb) => {
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
};

// ============================================================
// 3. Multer instances (all use memory storage)
// ============================================================
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

const uploadMaterial = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
});

const uploadProfile = multer({
  storage: storage,
  fileFilter: profileFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const uploadExamQuestions = multer({
  storage: storage,
  fileFilter: examQuestionsFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ============================================================
// 4. Helper: Upload to Vercel Blob and return public URL
// ============================================================
const uploadToBlob = async (file, folder = 'general') => {
  if (!file) throw new Error('No file provided');
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const ext = path.extname(file.originalname).toLowerCase();
  const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${baseName}-${uniqueSuffix}${ext}`;
  const blobPath = `${folder}/${filename}`;

  const blob = await put(blobPath, file.buffer, {
    access: 'public',
  });

  return blob.url; // permanent, publicly accessible URL
};

// ============================================================
// 5. Error handling wrappers (unchanged)
// ============================================================
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
        return res.status(500).json({
          success: false,
          message: 'File upload failed: ' + err.message
        });
      }
      next();
    });
  };
};

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
        return res.status(500).json({
          success: false,
          message: 'File upload failed: ' + err.message
        });
      }
      next();
    });
  };
};

// ============================================================
// 6. Exports
// ============================================================
module.exports = {
  upload,
  uploadMaterial,
  uploadProfile,
  uploadExamQuestions,
  uploadToBlob,              // <-- NEW: upload to Vercel Blob
  handleUploadError,
  handleExamQuestionsUploadError,
  uploadSingle: (fieldName) => handleUploadError(upload.single(fieldName)),
  uploadMaterialSingle: (fieldName) => handleUploadError(uploadMaterial.single(fieldName)),
  uploadProfileSingle: (fieldName) => handleUploadError(uploadProfile.single(fieldName)),
  uploadExamQuestionsSingle: (fieldName) => handleExamQuestionsUploadError(uploadExamQuestions.single(fieldName)),
  uploadArray: (fieldName, maxCount) => handleUploadError(upload.array(fieldName, maxCount)),
  uploadFields: (fields) => handleUploadError(upload.fields(fields))
};