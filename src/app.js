const express = require('express');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const methodOverride = require('method-override');
const notificationRoutes = require('./routes/notifications');
const fetch = require('node-fetch');
const teacherController = require('./controllers/teacherController');
const studentController = require('./controllers/studentController');

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const teacherRoutes = require('./routes/teacher');
const adminRoutes = require('./routes/admin');
const { setSchoolContext } = require('./middleware/auth');

// Initialize express app
const app = express();

// Set view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Middleware - IMPORTANT: These must be before routes
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true in production with HTTPS
}));

// Add user to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});
app.use('/api/notifications', notificationRoutes);

// Routes
app.use('/auth', authRoutes);
app.use('/student', studentRoutes);
app.use('/teacher', teacherRoutes);
app.use('/admin', adminRoutes);

app.use('/uploads/materials', express.static('uploads/materials'));
app.use('/uploads/profiles', express.static('uploads/profiles'));

// Apply to all routes that need school context
app.use('/teacher', setSchoolContext);
app.use('/student', setSchoolContext);
app.use('/admin', setSchoolContext);

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
    return res.status(403).render('error/403', { title: 'Access Denied' });
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
    
    // Add the new ReasonLabs proxy route
    routes.push({ path: '/api/proxy/reasonlabs', methods: ['GET'] });
    
    // Add other routes for student and admin as needed...
    
    res.json(routes);
  } catch (error) {
    console.error('Error in debug-routes:', error);
    res.status(500).json({ error: 'Failed to get routes' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error/404', { title: 'Page Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error/500', { title: 'Server Error' });
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

module.exports = app;