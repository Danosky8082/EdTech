const multer = require('multer');
const path = require('path');

// Configure storage for submissions
const submissionStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/submissions/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure storage for materials
const materialStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/materials/');
  },
  filename: function (req, file, cb) {
    // Preserve original file extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure storage for profile images
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/profiles/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter for all uploads
const fileFilter = (req, file, cb) => {
  // Accept all file types for submissions and materials
  cb(null, true);
};

// Create multer instances for different purposes
const upload = multer({
  storage: submissionStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for submissions
  }
});

const uploadMaterial = multer({
  storage: materialStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit for materials (videos can be large)
  }
});

const uploadProfile = multer({
  storage: profileStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for profile images
  }
});

// Single file upload helpers (for backward compatibility)
const uploadSingle = (fieldName) => upload.single(fieldName);
const uploadMaterialSingle = (fieldName) => uploadMaterial.single(fieldName);
const uploadProfileSingle = (fieldName) => uploadProfile.single(fieldName);

// Multiple file upload helpers (if needed)
const uploadMultiple = (fieldName, maxCount = 5) => upload.array(fieldName, maxCount);
const uploadMaterialMultiple = (fieldName, maxCount = 5) => uploadMaterial.array(fieldName, maxCount);

module.exports = {
  // Main instances
  upload,
  uploadMaterial,
  uploadProfile,
  
  // Single file upload helpers
  uploadSingle,
  uploadMaterialSingle,
  uploadProfileSingle,
  
  // Multiple file upload helpers
  uploadMultiple,
  uploadMaterialMultiple,
  
  // Original export for backward compatibility
  ...upload
};