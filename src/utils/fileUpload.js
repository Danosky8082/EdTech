const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ============================================================
// 1. Determine the base upload directory
// ============================================================
const isVercel = !!process.env.VERCEL;
const baseUploadDir = isVercel
  ? '/tmp/uploads'
  : path.join(__dirname, '../public/uploads');

// Subdirectories for different file types
const uploadDirs = {
  general: path.join(baseUploadDir, 'general'),
  materials: path.join(baseUploadDir, 'materials'),
  profiles: path.join(baseUploadDir, 'profiles'),
  exams: path.join(baseUploadDir, 'exams'),
};

// ============================================================
// 2. Ensure directories exist (create if missing)
// ============================================================
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created upload directory: ${dir}`);
  }
};

Object.values(uploadDirs).forEach(ensureDir);

// ============================================================
// 3. Storage configuration – dynamic destination based on type
// ============================================================
const storage = (dir) => multer.diskStorage({
  destination: (req, file, cb) => {
    // Ensure directory exists (should already, but double-check)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// ============================================================
// 4. File filters
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
// 5. Multer instances with different destinations and filters
// ============================================================
const upload = multer({
  storage: storage(uploadDirs.general),
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
});

const uploadMaterial = multer({
  storage: storage(uploadDirs.materials),
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
});

const uploadProfile = multer({
  storage: storage(uploadDirs.profiles),
  fileFilter: profileFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

const uploadExamQuestions = multer({
  storage: storage(uploadDirs.exams),
  fileFilter: examQuestionsFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ============================================================
// 6. Error handling middleware wrappers
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
// 7. Exports
// ============================================================
module.exports = {
  upload,
  uploadMaterial,
  uploadProfile,
  uploadExamQuestions,
  handleUploadError,
  handleExamQuestionsUploadError,
  uploadSingle: (fieldName) => handleUploadError(upload.single(fieldName)),
  uploadMaterialSingle: (fieldName) => handleUploadError(uploadMaterial.single(fieldName)),
  uploadProfileSingle: (fieldName) => handleUploadError(uploadProfile.single(fieldName)),
  uploadExamQuestionsSingle: (fieldName) => handleExamQuestionsUploadError(uploadExamQuestions.single(fieldName)),
  uploadArray: (fieldName, maxCount) => handleUploadError(upload.array(fieldName, maxCount)),
  uploadFields: (fields) => handleUploadError(upload.fields(fields))
};