const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Determine base upload directory (Vercel uses /tmp)
const isVercel = !!process.env.VERCEL;
const baseDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../../public/uploads');

// Create subdirectories
const materialsDir = path.join(baseDir, 'materials');
const profilesDir = path.join(baseDir, 'profiles');
[materialsDir, profilesDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Storage factory
const storage = (dest) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, dest),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + unique + ext);
  }
});

// --- File filters ---

// Images only (for profile)
const imageFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed for profile pictures.'), false);
  }
};

// All material types (documents, videos, presentations, images, audio, archives)
const materialFilter = (req, file, cb) => {
  const mimes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
    'application/zip', 'application/x-rar-compressed', 'text/plain'
  ];
  const exts = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt',
    '.ppt', '.pptx',
    '.mp4', '.avi', '.mov', '.mkv',
    '.mp3', '.wav', '.ogg',
    '.zip', '.rar'
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  if (mimes.includes(file.mimetype) || exts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed for materials.'), false);
  }
};

// --- Multer instances ---
const profileUpload = multer({
  storage: storage(profilesDir),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }   // 5 MB
});

const materialsUpload = multer({
  storage: storage(materialsDir),
  fileFilter: materialFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB
});

// --- Exports ---
module.exports = {
  profileUpload,
  materialsUpload,
  // Aliases for backward compatibility
  upload: profileUpload,
  uploadProfile: profileUpload,
  uploadMaterial: materialsUpload
};