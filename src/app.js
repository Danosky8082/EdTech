const express = require('express');
const session = require('express-session');
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
const noCache = require('./middleware/noCache');          // <-- NEW: import no-cache

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
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));
app.use(activityTracker());

app.use(flash());

// =============================================
// Apply no-cache to ALL authenticated routes
// (this prevents the browser from storing any page under these prefixes)
// =============================================
app.use('/student', noCache);
app.use('/teacher', noCache);
app.use('/admin', noCache);
app.use('/parent', noCache);
app.use('/accountant', noCache);
app.use('/cashier', noCache);

// =============================================
// NEW: Add user context to all views
// =============================================
app.use((req, res, next) => {
    // Make user available in all views
    if (req.session && req.session.user) {
        res.locals.user = req.session.user;
    } else {
        res.locals.user = null;
    }
    
    // Add other context variables
    res.locals.isSuperAdmin = req.isSuperAdmin || false;
    res.locals.userSchool = req.userSchool || null;
    res.locals.adminInfo = req.user?.admin || null;
    
    next();
});

// =============================================
// NEW: Updated notification middleware with safe handling
// =============================================
app.use(async (req, res, next) => {
  // Preserve the user from the previous middleware
  if (!res.locals.user && req.session.user) {
    res.locals.user = req.session.user;
  }
  
  // Only fetch notifications if user is authenticated
  if (req.session && req.session.user) {
    try {
      // Get notification count
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
      
      // Get recent notifications for the navbar
      const notifications = await prisma.notification.findMany({
        where: {
          userId: req.session.user.id,
          OR: [
            { expiresAt: { gt: new Date() } },
            { expiresAt: null }
          ]
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 10
      });
      
      // Format notifications for display
      const formatTimeAgo = (date) => {
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);
        
        if (diffInSeconds < 60) {
          return 'Just now';
        } else if (diffInSeconds < 3600) {
          const minutes = Math.floor(diffInSeconds / 60);
          return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        } else if (diffInSeconds < 86400) {
          const hours = Math.floor(diffInSeconds / 3600);
          return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        } else if (diffInSeconds < 2592000) {
          const days = Math.floor(diffInSeconds / 86400);
          return `${days} day${days !== 1 ? 's' : ''} ago`;
        } else {
          return date.toLocaleDateString();
        }
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
    // Redirect based on user role
    if (req.session.user.role === 'student') {
      res.redirect('/student/dashboard');
    } else if (req.session.user.role === 'teacher') {
      res.redirect('/teacher/dashboard');
    } else if (req.session.user.role === 'admin') {
      res.redirect('/admin/dashboard');
    } else if (req.session.user.role === 'parent') {
      res.redirect('/parent/dashboard');
    } else if (req.session.user.role === 'accountant') {
      res.redirect('/accountant/dashboard');
    } else if (req.session.user.role === 'cashier') {
      res.redirect('/cashier/dashboard');
    } else {
      res.redirect('/auth/login');
    }
  } else {
    res.redirect('/auth/login');
  }
});

// Common download route that handles both teachers and students
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

// ReasonLabs proxy route
app.get('/api/proxy/reasonlabs', async (req, res) => {
  try {
    console.log('🔄 Proxying ReasonLabs API request...');
    
    const apiResponse = await fetch('https://ab.reasonlabsapi.com/api/features/sdk-QtSYWOMLlkHBbNMB', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000
    });

    if (!apiResponse.ok) {
      throw new Error(`API responded with status: ${apiResponse.status}`);
    }

    const data = await apiResponse.json();
    
    res.json({
      success: true,
      data: data,
      proxied: true
    });

  } catch (error) {
    console.error('❌ ReasonLabs proxy error:', error);
    
    // Graceful fallback
    res.status(200).json({
      success: false,
      message: 'External service unavailable',
      fallback: true
    });
  }
});

// Simple debug routes endpoint
app.get('/debug-routes', (req, res) => {
  try {
    const routes = [];
    
    // Manually list all known routes since app._router might not be reliable
    routes.push({ path: '/', methods: ['GET'] });
    routes.push({ path: '/debug-routes', methods: ['GET'] });
    
    // Auth routes
    routes.push({ path: '/auth/login', methods: ['GET', 'POST'] });
    routes.push({ path: '/auth/register', methods: ['GET', 'POST'] });
    routes.push({ path: '/auth/logout', methods: ['POST'] });
    
    // Teacher routes
    routes.push({ path: '/teacher/dashboard', methods: ['GET'] });
    routes.push({ path: '/teacher/assignments', methods: ['GET'] });
    routes.push({ path: '/teacher/assignments/create', methods: ['POST'] });
    routes.push({ path: '/teacher/assignments/delete/:id', methods: ['DELETE'] });
    routes.push({ path: '/teacher/assignments/:id', methods: ['GET'] });
    routes.push({ path: '/teacher/grading', methods: ['GET'] });
    routes.push({ path: '/teacher/grading/:id', methods: ['GET'] });
    routes.push({ path: '/teacher/grading/:submissionId', methods: ['POST'] });
    routes.push({ path: '/teacher/classes', methods: ['GET'] });
    routes.push({ path: '/teacher/class/:id', methods: ['GET'] });
    routes.push({ path: '/teacher/class/:id/students', methods: ['GET'] });
    routes.push({ path: '/teacher/exams', methods: ['GET'] });
    routes.push({ path: '/teacher/exams/create', methods: ['POST'] });
    routes.push({ path: '/teacher/materials', methods: ['GET'] });
    routes.push({ path: '/teacher/materials/upload', methods: ['POST'] });
    routes.push({ path: '/teacher/students', methods: ['GET'] });
    routes.push({ path: '/teacher/exam', methods: ['GET'] });
    routes.push({ path: '/teacher/exam/viewExam', methods: ['POST'] });
    
    // Parent routes
    routes.push({ path: '/parent/dashboard', methods: ['GET'] });
    routes.push({ path: '/parent/student/:studentId', methods: ['GET'] });
    routes.push({ path: '/parent/payment', methods: ['POST'] });
    routes.push({ path: '/parent/wallet/add-funds', methods: ['POST'] });
    
    // Add the new ReasonLabs proxy route
    routes.push({ path: '/api/proxy/reasonlabs', methods: ['GET'] });
    
    // Add other routes for student and admin as needed...
    
    res.json(routes);
  } catch (error) {
    console.error('Error in debug-routes:', error);
    res.status(500).json({ error: 'Failed to get routes' });
  }
});

const ensureStudentData = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'student') {
        // Ensure studentId is always available
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

// =============================================
// UPDATED: Error handling middleware
// =============================================

// 404 handler - Updated to include message
app.use((req, res) => {
    const user = req.session?.user || null;
    const isSuperAdmin = req.isSuperAdmin || false;
    const userSchool = req.userSchool || null;
    
    res.status(404).render('error/404', {
        title: 'Page Not Found',
        message: 'The page you are looking for could not be found.',
        user: user,
        isSuperAdmin: isSuperAdmin,
        userSchool: userSchool,
        adminInfo: user?.admin || null
    });
});

// Error handler - UPDATED to always include message
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    
    // Get user context
    const user = req.session?.user || null;
    const isSuperAdmin = req.isSuperAdmin || false;
    const userSchool = req.userSchool || null;
    
    // Determine status code
    const statusCode = err.status || 500;
    
    // Set appropriate message based on status code
    let message = 'An unexpected error occurred. Please try again later.';
    if (statusCode === 400) {
        message = 'Bad Request. Please check your input and try again.';
    } else if (statusCode === 401) {
        message = 'You are not authorized to access this page.';
    } else if (statusCode === 403) {
        message = 'You do not have permission to access this resource.';
    } else if (statusCode === 404) {
        message = 'The requested resource could not be found.';
    }
    
    // Override with error message if available and in development
    if (process.env.NODE_ENV === 'development' && err.message) {
        message = err.message;
    }
    
    // Render error page with all required variables
    res.status(statusCode).render(`error/${statusCode}`, {
        title: statusCode === 404 ? 'Page Not Found' : 'Server Error',
        message: message,
        user: user,
        isSuperAdmin: isSuperAdmin,
        userSchool: userSchool,
        error: process.env.NODE_ENV === 'development' ? err : null,
        adminInfo: user?.admin || null
    });
});

module.exports = app;