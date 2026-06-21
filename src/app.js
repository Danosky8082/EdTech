const express = require('express');

app.get('/debug-files', (req, res) => {
  try {
    const dir = '/tmp/uploads/profiles';
    let result = { directory: dir };

    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      result.files = files;
      result.count = files.length;
      result.exists = true;
    } else {
      result.exists = false;
      result.error = 'Directory does not exist yet';
      // Try to create it to see if we have write permissions
      try {
        fs.mkdirSync(dir, { recursive: true });
        result.created = true;
        result.files = [];
        result.count = 0;
      } catch (mkdirErr) {
        result.created = false;
        result.mkdirError = mkdirErr.message;
      }
    }

    // Also check if the parent /tmp/uploads exists
    const parentDir = '/tmp/uploads';
    if (fs.existsSync(parentDir)) {
      const parentFiles = fs.readdirSync(parentDir);
      result.parentExists = true;
      result.parentContents = parentFiles;
    } else {
      result.parentExists = false;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});


process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Rejection:', err);
});
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const flash = require('express-flash');
const path = require('path');
const fs = require('fs');                       //for file checks
const dotenv = require('dotenv');
const methodOverride = require('method-override');
const notificationRoutes = require('./routes/notifications');
const fetch = require('node-fetch');
const teacherController = require('./controllers/teacherController');
const studentController = require('./controllers/studentController');
const prisma = require('./config/database');
const activityTracker = require('./middleware/activityTracker');
const noCache = require('./middleware/noCache');

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const teacherRoutes = require('./routes/teacher');
const adminRoutes = require('./routes/admin');
const { setSchoolContext } = require('./middleware/auth');
const parentRoutes = require('./routes/parent');
const accountantRoutes = require('./routes/accountant');
const cashierRoutes = require('./routes/cashier');

// Initialize express app
const app = express();
app.set('trust proxy', 1);

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Static files (public folder and general uploads)
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));   // fallback for other uploads

// ============================================================
// Custom routes to serve uploaded images from /tmp (Vercel)
// with fallback to local uploads folder
// ============================================================
app.get('/uploads/profiles/:filename', (req, res) => {
  const filename = req.params.filename;
  const tmpPath = path.join('/tmp/uploads/profiles', filename);
  const localPath = path.join(__dirname, '../public/uploads/profiles', filename);

  if (fs.existsSync(tmpPath)) {
    return res.sendFile(tmpPath);
  }
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }
  res.status(404).send('Image not found');
});

app.get('/uploads/materials/:filename', (req, res) => {
  const filename = req.params.filename;
  const tmpPath = path.join('/tmp/uploads/materials', filename);
  const localPath = path.join(__dirname, '../public/uploads/materials', filename);

  if (fs.existsSync(tmpPath)) {
    return res.sendFile(tmpPath);
  }
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }
  res.status(404).send('File not found');
});

// Body parsing and method override
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));

// Session (PostgreSQL store)
app.use(session({
  store: new pgSession({
    conObject: {
      connectionString: process.env.DATABASE_URL,
    },
    tableName: 'session',
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// Custom middleware
app.use(activityTracker());
app.use(flash());

// No-cache for authenticated routes
app.use('/student', noCache);
app.use('/teacher', noCache);
app.use('/admin', noCache);
app.use('/parent', noCache);
app.use('/accountant', noCache);
app.use('/cashier', noCache);

// User context for views
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user;
  } else {
    res.locals.user = null;
  }
  res.locals.isSuperAdmin = req.isSuperAdmin || false;
  res.locals.userSchool = req.userSchool || null;
  res.locals.adminInfo = req.user?.admin || null;
  next();
});

// Notifications middleware
app.use(async (req, res, next) => {
  if (!res.locals.user && req.session.user) {
    res.locals.user = req.session.user;
  }
  if (req.session && req.session.user) {
    try {
      const notificationCount = await prisma.notification.count({
        where: {
          userId: req.session.user.id,
          read: false,
          OR: [
            { expiresAt: { gt: new Date() } },
            { expiresAt: null },
          ],
        },
      });
      res.locals.unreadNotifications = notificationCount;

      const notifications = await prisma.notification.findMany({
        where: {
          userId: req.session.user.id,
          OR: [
            { expiresAt: { gt: new Date() } },
            { expiresAt: null },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const formatTimeAgo = (date) => {
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);
        if (diffInSeconds < 60) return 'Just now';
        if (diffInSeconds < 3600) {
          const minutes = Math.floor(diffInSeconds / 60);
          return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        }
        if (diffInSeconds < 86400) {
          const hours = Math.floor(diffInSeconds / 3600);
          return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        }
        if (diffInSeconds < 2592000) {
          const days = Math.floor(diffInSeconds / 86400);
          return `${days} day${days !== 1 ? 's' : ''} ago`;
        }
        return date.toLocaleDateString();
      };

      res.locals.notificationsData = notifications.map((notif) => ({
        id: notif.id,
        title: notif.title,
        message: notif.message,
        icon: notif.icon,
        read: notif.read,
        createdAt: notif.createdAt,
        time: formatTimeAgo(notif.createdAt),
      }));
    } catch (error) {
      console.error('Error getting notification count:', error);
      res.locals.unreadNotifications = 0;
      res.locals.notificationsData = [];
    }
  } else {
    res.locals.unreadNotifications = 0;
    res.locals.notificationsData = [];
  }
  next();
});

// API routes
app.use('/api/notifications', notificationRoutes);

// Main routes
app.use('/auth', authRoutes);
app.use('/student', studentRoutes);
app.use('/teacher', teacherRoutes);
app.use('/admin', adminRoutes);
app.use('/parent', parentRoutes);
app.use('/accountant', accountantRoutes);
app.use('/cashier', cashierRoutes);

// School context middleware
app.use('/teacher', setSchoolContext);
app.use('/student', setSchoolContext);
app.use('/admin', setSchoolContext);
app.use('/accountant', setSchoolContext);
app.use('/cashier', setSchoolContext);

// Home route (redirects based on role)
app.get('/', (req, res) => {
  if (req.session.user) {
    const role = req.session.user.role;
    const redirectMap = {
      student: '/student/dashboard',
      teacher: '/teacher/dashboard',
      admin: '/admin/dashboard',
      parent: '/parent/dashboard',
      accountant: '/accountant/dashboard',
      cashier: '/cashier/dashboard',
    };
    res.redirect(redirectMap[role] || '/auth/login');
  } else {
    res.redirect('/auth/login');
  }
});

// Download route (handles both teachers and students)
app.get('/download/material/:materialId', (req, res) => {
  if (req.session.user.role === 'teacher') {
    return teacherController.downloadMaterial(req, res);
  } else if (req.session.user.role === 'student') {
    return studentController.downloadMaterial(req, res);
  } else {
    return res.status(403).render('error/403', {
      title: 'Access Denied',
      user: res.locals.user,
      isSuperAdmin: res.locals.isSuperAdmin,
      userSchool: res.locals.userSchool,
      adminInfo: res.locals.adminInfo,
      message: 'You do not have permission to download this material.',
    });
  }
});

// ReasonLabs proxy
app.get('/api/proxy/reasonlabs', async (req, res) => {
  try {
    console.log('🔄 Proxying ReasonLabs API request...');
    const apiResponse = await fetch('https://ab.reasonlabsapi.com/api/features/sdk-QtSYWOMLlkHBbNMB', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    if (!apiResponse.ok) throw new Error(`API responded with status: ${apiResponse.status}`);
    const data = await apiResponse.json();
    res.json({ success: true, data, proxied: true });
  } catch (error) {
    console.error('❌ ReasonLabs proxy error:', error);
    res.status(200).json({ success: false, message: 'External service unavailable', fallback: true });
  }
});

// =============================================
// Error handling (production ready)
// =============================================

// 404 handler
app.use((req, res) => {
  const user = req.session?.user || null;
  res.status(404).render('error/404', {
    title: 'Page Not Found',
    message: 'The page you are looking for could not be found.',
    user: user,
    isSuperAdmin: req.isSuperAdmin || false,
    userSchool: req.userSchool || null,
    adminInfo: user?.admin || null,
  });
});

// 500 handler (with error page)
app.use((err, req, res, next) => {
  console.error('💥 Global error:', err);
  const user = req.session?.user || null;
  const statusCode = err.status || 500;
  let message = 'An unexpected error occurred. Please try again later.';
  if (statusCode === 400) message = 'Bad Request. Please check your input and try again.';
  else if (statusCode === 401) message = 'You are not authorized to access this page.';
  else if (statusCode === 403) message = 'You do not have permission to access this resource.';
  else if (statusCode === 404) message = 'The requested resource could not be found.';

  if (process.env.NODE_ENV === 'development' && err.message) {
    message = err.message;
  }

  res.status(statusCode).render(`error/${statusCode}`, {
    title: statusCode === 404 ? 'Page Not Found' : 'Server Error',
    message: message,
    user: user,
    isSuperAdmin: req.isSuperAdmin || false,
    userSchool: req.userSchool || null,
    error: process.env.NODE_ENV === 'development' ? err : null,
    adminInfo: user?.admin || null,
  });
});

module.exports = app;