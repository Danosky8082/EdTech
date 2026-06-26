const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ============================================================
// 1. DETERMINE UPLOAD DIRECTORY (Vercel / local)
// ============================================================
const isVercel = !!process.env.VERCEL;
const baseUploadDir = isVercel
  ? '/tmp/uploads'
  : path.join(__dirname, '../../public/uploads');

const materialsDir = path.join(baseUploadDir, 'materials');
const profilesDir = path.join(baseUploadDir, 'profiles');

// Ensure directories exist
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created upload directory: ${dir}`);
  }
};
ensureDir(materialsDir);
ensureDir(profilesDir);

// ============================================================
// 2. STORAGE CONFIGURATIONS
// ============================================================
const createStorage = (destination) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, destination),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const profileStorage = createStorage(profilesDir);
const materialsStorage = createStorage(materialsDir);

// ============================================================
// 3. FILE FILTERS
// ============================================================

// --- Profile: images only ---
const imageFileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed for profile pictures.'), false);
  }
};

// --- Materials: broad filter (documents, videos, presentations, images, audio, archives) ---
const materialsFileFilter = (req, file, cb) => {
  const allowedMimes = [
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    // Presentations
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Videos
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
    // Audio
    'audio/mpeg', 'audio/wav', 'audio/ogg',
    // Archives
    'application/zip', 'application/x-rar-compressed'
  ];

  const allowedExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt',
    '.ppt', '.pptx',
    '.mp4', '.avi', '.mov', '.mkv',
    '.mp3', '.wav', '.ogg',
    '.zip', '.rar'
  ];

  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;

  if (allowedMimes.includes(mimeType) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed. Please upload images, documents, videos, presentations, audio, or archives.'), false);
  }
};

// ============================================================
// 4. MULTER INSTANCES
// ============================================================

// Profile upload (avatar) – images only, max 5MB
const profileUpload = multer({
  storage: profileStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Materials upload – broad file types, max 100MB
const materialsUpload = multer({
  storage: materialsStorage,
  fileFilter: materialsFileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Generic single-file uploader (if you need it elsewhere)
const uploadSingle = (fieldName) => multer({
  storage: materialsStorage,
  fileFilter: materialsFileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
}).single(fieldName);

// ============================================================
// 5. EXPORTS
// ============================================================
module.exports = {
  // Profile upload (field name: 'avatar')
  upload: profileUpload,           // for backward compatibility
  profileUpload,
  uploadProfile: profileUpload,    // alias

  // Materials upload (field name: 'materialFile')
  materialsUpload,
  uploadMaterial: materialsUpload, // alias

  // Generic single file uploader (field name passed)
  uploadSingle,

  // If you need multiple files, you can add:
  // uploadMultiple: (fieldName, maxCount) => multer({...}).array(fieldName, maxCount)
};