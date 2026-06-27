const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();  // load .env as early as possible

// ============================================================
// Initialize app early so all routes can use it
// ============================================================
const app = express();
app.set('trust proxy', 1);

// ============================================================
// Process error handlers (can be placed anywhere)
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Rejection:', err);
});

// ============================================================
// Other requires
// ============================================================
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const flash = require('express-flash');
const methodOverride = require('method-override');

// ✅ FIX: Keep only one notificationRoutes import
const notificationRoutes = require('./routes/notification.routes');


const fetch = require('node-fetch');
const teacherController = require('./controllers/teacherController');
const studentController = require('./controllers/studentController');
const prisma = require('./config/database');
const activityTracker = require('./middleware/activityTracker');
const noCache = require('./middleware/noCache');


// Import routes
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const teacherRoutes = require('./routes/teacher');
const adminRoutes = require('./routes/admin');
const { setSchoolContext } = require('./middleware/auth');
const parentRoutes = require('./routes/parent');
const accountantRoutes = require('./routes/accountant');
const cashierRoutes = require('./routes/cashier');


// ============================================================
// View engine
// ============================================================
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ============================================================
// Custom routes to serve uploaded images from /tmp (Vercel)
// Must come BEFORE static middleware
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

// ============================================================
// Simple debug route (safe, won't crash if directory missing)
// ============================================================
app.get('/debug-files', (req, res) => {
  try {
    const dir = '/tmp/uploads/profiles';
    const result = { directory: dir };
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      result.files = files;
      result.count = files.length;
      result.exists = true;
    } else {
      result.exists = false;
      // try to create it to see if we have write permissions
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
    // also check parent
    const parentDir = '/tmp/uploads';
    if (fs.existsSync(parentDir)) {
      const parentFiles = fs.readdirSync(parentDir);
      result.parentExists = true;
      result.parentContents = parentFiles;
    } else {
      result.parentExists = false;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ============================================================
// Static files (fallback)
// ============================================================
app.use(express.static('public'));
app.use('/uploads', express.static('uploads')); // local fallback

// ============================================================
// Body parsing and method override
// ============================================================
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));

// ============================================================
// Session (PostgreSQL store)
// ============================================================
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
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

// ============================================================
// Custom middleware
// ============================================================
app.use(activityTracker());
app.use(flash());

// No-cache for authenticated routes
app.use('/student', noCache);
app.use('/teacher', noCache);
app.use('/admin', noCache);
app.use('/parent', noCache);
app.use('/accountant', noCache);
app.use('/cashier', noCache);
app.use('/notifications', notificationRoutes);

// ✅ Mount notification routes (works for both /notifications and /api/notifications)
app.use('/notifications', notificationRoutes);
// Optionally, if you want a separate API prefix, you could add:
// app.use('/api/notifications', notificationRoutes);

// User context
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

// ============================================================
// Enhanced navbar data middleware (notifications + avatar)
// ============================================================
app.use(async (req, res, next) => {
  // Default values (no user)
  res.locals.notificationCount = 0;
  res.locals.notificationsDropdownHtml = '';
  res.locals.avatarUrl = '';
  res.locals.fallbackAvatar = '';
  res.locals.userFirstName = '';
  res.locals.userLastName = '';
  res.locals.userRole = '';

  // If no user, skip
  if (!req.session || !req.session.user) {
    return next();
  }

  const user = req.session.user;
  const userId = user.id;

  // ----- 1. Notification data -----
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const unreadCount = notifications.filter(n => !n.read).length;
    res.locals.notificationCount = unreadCount;

    // Build dropdown HTML (same logic as dashboard)
    let dropdownHtml = '';
    if (notifications && notifications.length > 0) {
      let itemsHtml = '';
      const display = notifications.slice(0, 5);
      display.forEach(n => {
        const isRead = n.read ? 'read' : 'unread';
        const icon = n.icon || 'fa-info-circle';
        const title = n.title || 'Notification';
        const msg = n.message || '';
        const time = n.createdAt ? new Date(n.createdAt).toLocaleString() : '';
        const notifId = n.id || '';
        const newBadge = !n.read ? `<span class="badge bg-danger ms-1">New</span>` : '';
        const actions = !n.read
          ? `<div class="notification-actions">
               <button class="notification-action-btn mark-as-read-btn" onclick="event.stopPropagation(); markNotificationAsRead('${notifId}')">Mark as read</button>
             </div>`
          : '';
        itemsHtml += `
          <li class="notification-item ${isRead}" data-notification-id="${notifId}">
            <div class="notification-icon"><i class="fas ${icon}"></i></div>
            <div class="notification-content">
              <div class="notification-title">${title} ${newBadge}</div>
              <div class="notification-message">${msg}</div>
              <div class="notification-time">${time}</div>
              ${actions}
            </div>
          </li>
        `;
      });
      const header = `<li class="notification-header">
                        <span>Notifications</span>
                        ${unreadCount > 0 ? `<span class="badge bg-primary rounded-pill">${unreadCount}</span>` : ''}
                      </li>`;
      const markAll = `<li class="mark-all-read" onclick="markAllNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Mark all as read</li>`;
      dropdownHtml = header + itemsHtml + markAll;
    } else {
      dropdownHtml = `<li class="notification-empty"><i class="fas fa-bell-slash"></i><p>No notifications</p></li>`;
    }
    res.locals.notificationsDropdownHtml = dropdownHtml;

  } catch (error) {
    console.error('Error fetching notifications for navbar:', error);
    res.locals.notificationCount = 0;
    res.locals.notificationsDropdownHtml = `<li class="notification-empty"><i class="fas fa-bell-slash"></i><p>Error loading notifications</p></li>`;
  }

  // ----- 2. Avatar and user info -----
  try {
    const firstName = user.firstName || '';
    const lastName = user.lastName || '';
    res.locals.userFirstName = firstName;
    res.locals.userLastName = lastName;
    res.locals.userRole = user.role || '';

    let avatarUrl = '';
    let fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + ' ' + lastName)}&background=6a11cb&color=fff&size=36`;
    if (user.avatar) {
      if (user.avatar.startsWith('http://') || user.avatar.startsWith('https://')) {
        avatarUrl = user.avatar;
      } else {
        avatarUrl = '/' + user.avatar;
      }
    }
    res.locals.avatarUrl = avatarUrl;
    res.locals.fallbackAvatar = fallbackAvatar;

  } catch (error) {
    console.error('Error processing avatar data:', error);
    res.locals.avatarUrl = '';
    res.locals.fallbackAvatar = '';
  }

  next();
});

// API routes
// app.use('/api/notifications', notificationRoutes); // optional – already mounted at /notifications

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

// Home route
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

// Download route
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
// Error handling
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

// 500 handler
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