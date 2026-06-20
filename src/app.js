const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const flash = require('express-flash');
const path = require('path');
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

// Set view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Middleware
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));

// ============================================================
// UPDATED SESSION MIDDLEWARE – uses PostgreSQL for persistence
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
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

app.use(activityTracker());
app.use(flash());

// =============================================
// Apply no-cache to ALL authenticated routes
// =============================================
app.use('/student', noCache);
app.use('/teacher', noCache);
app.use('/admin', noCache);
app.use('/parent', noCache);
app.use('/accountant', noCache);
app.use('/cashier', noCache);

// =============================================
// Add user context to all views
// =============================================
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

// =============================================
// Notification middleware
// =============================================
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
            { expiresAt: null }
          ]
        }
      });
      res.locals.unreadNotifications = notificationCount;
      
      const notifications = await prisma.notification.findMany({
        where: {
          userId: req.session.user.id,
          OR: [
            { expiresAt: { gt: new Date() } },
            { expiresAt: null }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 10
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
      
      res.locals.notificationsData = notifications.map(notif => ({
        id: notif.id,
        title: notif.title,
        message: notif.message,
        icon: notif.icon,
        read: notif.read,
        createdAt: notif.createdAt,
        time: formatTimeAgo(notif.createdAt)
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

app.use('/api/notifications', notificationRoutes);

// Routes
app.use('/auth', authRoutes);
app.use('/student', studentRoutes);
app.use('/teacher', teacherRoutes);
app.use('/admin', adminRoutes);
app.use('/parent', parentRoutes);
app.use('/accountant', accountantRoutes);
app.use('/cashier', cashierRoutes);

app.use('/uploads/materials', express.static('uploads/materials'));
app.use('/uploads/profiles', express.static('uploads/profiles'));

// Apply school context middleware
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
      cashier: '/cashier/dashboard'
    };
    res.redirect(redirectMap[role] || '/auth/login');
  } else {
    res.redirect('/auth/login');
  }
});

// Common download route
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
      message: 'You do not have permission to download this material.'
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
      timeout: 10000
    });
    if (!apiResponse.ok) throw new Error(`API responded with status: ${apiResponse.status}`);
    const data = await apiResponse.json();
    res.json({ success: true, data, proxied: true });
  } catch (error) {
    console.error('❌ ReasonLabs proxy error:', error);
    res.status(200).json({ success: false, message: 'External service unavailable', fallback: true });
  }
});

// Debug routes
app.get('/debug-routes', (req, res) => {
  try {
    const routes = [
      { path: '/', methods: ['GET'] },
      { path: '/debug-routes', methods: ['GET'] },
      { path: '/auth/login', methods: ['GET', 'POST'] },
      { path: '/auth/register', methods: ['GET', 'POST'] },
      { path: '/auth/logout', methods: ['POST'] },
      { path: '/teacher/dashboard', methods: ['GET'] },
      { path: '/teacher/assignments', methods: ['GET'] },
      { path: '/teacher/assignments/create', methods: ['POST'] },
      { path: '/teacher/assignments/delete/:id', methods: ['DELETE'] },
      { path: '/teacher/assignments/:id', methods: ['GET'] },
      { path: '/teacher/grading', methods: ['GET'] },
      { path: '/teacher/grading/:id', methods: ['GET'] },
      { path: '/teacher/grading/:submissionId', methods: ['POST'] },
      { path: '/teacher/classes', methods: ['GET'] },
      { path: '/teacher/class/:id', methods: ['GET'] },
      { path: '/teacher/class/:id/students', methods: ['GET'] },
      { path: '/teacher/exams', methods: ['GET'] },
      { path: '/teacher/exams/create', methods: ['POST'] },
      { path: '/teacher/materials', methods: ['GET'] },
      { path: '/teacher/materials/upload', methods: ['POST'] },
      { path: '/teacher/students', methods: ['GET'] },
      { path: '/teacher/exam', methods: ['GET'] },
      { path: '/teacher/exam/viewExam', methods: ['POST'] },
      { path: '/parent/dashboard', methods: ['GET'] },
      { path: '/parent/student/:studentId', methods: ['GET'] },
      { path: '/parent/payment', methods: ['POST'] },
      { path: '/parent/wallet/add-funds', methods: ['POST'] },
      { path: '/api/proxy/reasonlabs', methods: ['GET'] }
    ];
    res.json(routes);
  } catch (error) {
    console.error('Error in debug-routes:', error);
    res.status(500).json({ error: 'Failed to get routes' });
  }
});

const ensureStudentData = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'student') {
        if (!req.session.user.studentId) {
            console.log('⚠️ studentId missing from session, redirecting to login');
            return res.redirect('/auth/login');
        }
    }
    next();
};

app.get('/health/student-session', (req, res) => {
    res.json({
        session: req.session,
        user: req.session.user,
        studentId: req.session.user?.studentId,
        classId: req.params.classId
    });
});

app.get('/debug', async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    res.json({
      status: 'ok',
      database: 'connected',
      userCount,
      session: req.session ? 'exists' : 'none',
      sessionID: req.sessionID || 'none'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// =============================================
// Check if session table exists (for debugging)
// =============================================
app.get('/check-session-table', async (req, res) => {
  try {
    // Test the simplest possible operation
    const result = await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'db works', result });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// =============================================
// ERROR HANDLING – for debugging (returns JSON)
// =============================================

// 404 handler – keep as is
app.use((req, res) => {
  res.status(404).send('404: Page not found');
});

// 500 handler – show detailed error
app.use((err, req, res, next) => {
  console.error('💥 Global error:', err);
  res.status(500).json({
    error: err.message,
    stack: err.stack,
    // include request info to help debug
    path: req.path,
    method: req.method,
    query: req.query,
    body: req.body,
  });
});

app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    const user = req.session?.user || null;
    const statusCode = err.status || 500;
    let message = 'An unexpected error occurred. Please try again later.';
    if (statusCode === 400) message = 'Bad Request. Please check your input and try again.';
    else if (statusCode === 401) message = 'You are not authorized to access this page.';
    else if (statusCode === 403) message = 'You do not have permission to access this resource.';
    else if (statusCode === 404) message = 'The requested resource could not be found.';
    if (process.env.NODE_ENV === 'development' && err.message) message = err.message;
    
    res.status(statusCode).render(`error/${statusCode}`, {
        title: statusCode === 404 ? 'Page Not Found' : 'Server Error',
        message: message,
        user: user,
        isSuperAdmin: req.isSuperAdmin || false,
        userSchool: req.userSchool || null,
        error: process.env.NODE_ENV === 'development' ? err : null,
        adminInfo: user?.admin || null
    });
});

module.exports = app;