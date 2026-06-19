const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ============================================================
// 1. Determine a writable base directory for uploads
// ============================================================
// On Vercel, the filesystem is ephemeral – use /tmp/uploads
// Locally, use the public/uploads folder.
const isVercel = !!process.env.VERCEL;
const baseUploadDir = isVercel
  ? '/tmp/uploads'
  : path.join(__dirname, '../../public/uploads');

// Subdirectories for different upload types
const materialsDir = path.join(baseUploadDir, 'materials');

// ============================================================
// 2. Ensure directories exist (with recursive creation)
// ============================================================
const ensureDir = (dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`✅ Created upload directory: ${dirPath}`);
    }
    return true;
  } catch (err) {
    console.error(`❌ Failed to create directory ${dirPath}:`, err.message);
    // On Vercel, if we can't write to /tmp, something is very wrong.
    // We'll still try to use the directory; multer will fail later.
    return false;
  }
};

ensureDir(materialsDir);

// ============================================================
// 3. Multer storage configuration
// ============================================================
const materialStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    // The directory should already exist, but we double‑check
    if (!fs.existsSync(materialsDir)) {
      ensureDir(materialsDir);
    }
    cb(null, materialsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = file.fieldname + '-' + uniqueSuffix + ext;
    cb(null, filename);
  }
});

// ============================================================
// 4. File filter for allowed types
// ============================================================
const materialFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/gif',
    'video/mp4',
    'video/mpeg',
    'application/zip',
    'application/x-rar-compressed'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only documents, images, videos, and compressed files are allowed.'), false);
  }
};

// ============================================================
// 5. Create multer instance
// ============================================================
const materialUpload = multer({
  storage: materialStorage,
  fileFilter: materialFileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max file size
  }
});

// ============================================================
// 6. Export
// ============================================================
module.exports = {
  upload: materialUpload
};