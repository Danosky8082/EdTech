const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Determine base upload directory
const isVercel = !!process.env.VERCEL;
const baseUploadDir = isVercel
  ? '/tmp/uploads'
  : path.join(__dirname, '../../public/uploads');

// Subdirectories
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

// Storage for profile images (used in registration)
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, profilesDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// File filter
const imageFileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed.'), false);
  }
};

// Multer instance for profile images (max 5MB)
const profileUpload = multer({
  storage: profileStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

module.exports = {
  upload: profileUpload,          // for single file uploads
  // if you need other uploads (materials), you can also export them
  materialsUpload: multer({
    storage: multer.diskStorage({
      destination: function (req, file, cb) {
        cb(null, materialsDir);
      },
      filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
      }
    }),
    fileFilter: (req, file, cb) => {
      // your existing file filter for materials
      cb(null, true);
    },
    limits: { fileSize: 100 * 1024 * 1024 }
  })
};