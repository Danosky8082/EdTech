const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ============================================================
// 1. Determine the base upload directory (Vercel-aware)
// ============================================================
const isVercel = !!process.env.VERCEL;
const baseUploadDir = isVercel
  ? '/tmp/uploads'
  : path.join(__dirname, '../../public/uploads');

// ============================================================
// 2. Ensure base directory exists
// ============================================================
if (!fs.existsSync(baseUploadDir)) {
  fs.mkdirSync(baseUploadDir, { recursive: true });
  console.log(`✅ Created base upload directory: ${baseUploadDir}`);
}

// ============================================================
// 3. Dynamic storage – destination based on field name
// ============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Determine subfolder based on field name
    let subfolder = '';
    if (file.fieldname === 'profile' || file.fieldname === 'avatar') {
      subfolder = 'profiles';
    } else if (file.fieldname === 'material' || file.fieldname === 'file') {
      subfolder = 'materials';
    } else if (file.fieldname === 'examQuestions' || file.fieldname === 'exam') {
      subfolder = 'exams';
    } else {
      subfolder = 'general';
    }

    const dest = path.join(baseUploadDir, subfolder);
    // Ensure subfolder exists (should already, but double-check)
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
      console.log(`✅ Created subfolder: ${dest}`);
    }
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    // Sanitize filename
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, baseName + '-' + uniqueSuffix + ext);
  }
});

// ============================================================
// 4. File filters (unchanged)
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
// 5. Multer instances (all use the same dynamic storage)
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
// 6. Error handling wrappers (unchanged)
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