const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Directories
const isVercel = !!process.env.VERCEL;
const baseDir = isVercel ? '/tmp/uploads' : path.join(__dirname, '../../public/uploads');
const materialsDir = path.join(baseDir, 'materials');
const profilesDir = path.join(baseDir, 'profiles');

// Create folders
[materialsDir, profilesDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Storage
const storage = (dest) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, dest),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
  }
});

// File filters
const imageFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images allowed'), false);
};

const materialFilter = (req, file, cb) => {
  const mimes = [
    'image/jpeg','image/png','image/gif','image/webp',
    'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4','video/quicktime','video/x-msvideo','video/x-matroska',
    'audio/mpeg','audio/wav','audio/ogg',
    'application/zip','application/x-rar-compressed','text/plain'
  ];
  const exts = ['.jpg','.jpeg','.png','.gif','.webp','.pdf','.doc','.docx','.xls','.xlsx','.txt','.ppt','.pptx','.mp4','.avi','.mov','.mkv','.mp3','.wav','.ogg','.zip','.rar'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (mimes.includes(file.mimetype) || exts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed for materials'), false);
  }
};

// Multer instances
const profileUpload = multer({
  storage: storage(profilesDir),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

const materialsUpload = multer({
  storage: storage(materialsDir),
  fileFilter: materialFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ✅ Explicit exports
module.exports = {
  profileUpload,
  materialsUpload
};