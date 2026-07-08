const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();  // load .env as early as possible

const app = express();
app.set('trust proxy', 1);

console.log('🚀 app.js loaded - routes are being registered');

// ============================================================
// Process error handlers
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
const { setSchoolContext, setStudentTuitionStatus } = require('./middleware/auth');
const parentRoutes = require('./routes/parent');
const accountantRoutes = require('./routes/accountant');
const cashierRoutes = require('./routes/cashier');

// Profile controller
const profileController = require('./controllers/profileController');
const { uploadProfileSingle } = require('./utils/fileUpload');
const { isAuthenticated } = require('./middleware/auth');

// ============================================================
// View engine
// ============================================================
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ============================================================
// Custom routes to serve uploaded images from /tmp (Vercel)
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
// Simple debug route
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
// Static files
// ============================================================
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

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
    createTableIfMissing: true,
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
// Custom middleware (order matters!)
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

// ============================================================
// ✅ GLOBAL SCHOOL CONTEXT AND STUDENT TUITION STATUS
// ============================================================
app.use(setSchoolContext);
app.use(setStudentTuitionStatus);

// ============================================================
// User context middleware (populates res.locals for views)
// ============================================================
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

// ============================================================
// ✅ PROFILE ROUTES (for all authenticated users)
// ============================================================
app.get('/profile', isAuthenticated, profileController.getProfile);
app.post('/profile', isAuthenticated, uploadProfileSingle('avatar'), profileController.updateProfile);
app.post('/profile/change-password', isAuthenticated, profileController.changePassword);

// ============================================================
// QR SCANNER ROUTES – MUST BE ABOVE THE 404 HANDLER
// ============================================================

// Simple test route – remove this after it works
app.get('/test', (req, res) => {
  res.send('Test route works!');
});

// Scanner page (temporarily remove auth for testing)
app.get('/scan', (req, res) => {
  res.render('scan');
});

// --- PUBLIC API: Scan QR code with actions ---
app.get('/api/scan/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { action, bookId, classId, notes } = req.query;

    const user = await prisma.user.findUnique({
      where: { qrToken: token },
      include: {
        student: true,
        teacher: true,
        parent: { include: { wallet: true } }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // --- ATTENDANCE ---
    if (action === 'attendance') {
      if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in to record attendance.' });
      }

      // Prevent duplicate attendance today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const existing = await prisma.attendance.findFirst({
        where: {
          studentId: user.student.id,
          date: {
            gte: today,
            lt: tomorrow
          }
        }
      });

      if (existing) {
        return res.json({
          success: false,
          message: 'Attendance already recorded for today.',
          attendance: existing
        });
      }

      const attendance = await prisma.attendance.create({
        data: {
          studentId: user.student.id,
          classId: classId || null,
          status: 'present',
          recordedBy: req.session.user.id,
          notes: notes || 'Scanned via QR'
        }
      });

      return res.json({
        success: true,
        message: 'Attendance recorded successfully',
        attendance
      });
    }

    // --- LIBRARY (Borrow / Return) ---
    if (action === 'library' && bookId) {
      if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in for library transactions.' });
      }

      // Check if student already has this book (active borrow)
      const existingBorrow = await prisma.libraryTransaction.findFirst({
        where: {
          studentId: user.student.id,
          bookId: bookId,
          action: 'borrow',
          returnedAt: null
        }
      });

      if (existingBorrow) {
        // Return the book
        await prisma.libraryTransaction.create({
          data: {
            studentId: user.student.id,
            bookId: bookId,
            action: 'return',
            recordedBy: req.session.user.id,
            returnedAt: new Date(),
            notes: notes || 'Returned via QR scan'
          }
        });
        await prisma.book.update({
          where: { id: bookId },
          data: { available: { increment: 1 } }
        });
        return res.json({
          success: true,
          message: `Book returned successfully.`
        });
      } else {
        // Borrow the book
        const book = await prisma.book.findUnique({ where: { id: bookId } });
        if (!book || book.available <= 0) {
          return res.status(400).json({ success: false, message: 'Book not available for borrowing' });
        }
        await prisma.libraryTransaction.create({
          data: {
            studentId: user.student.id,
            bookId: bookId,
            action: 'borrow',
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            recordedBy: req.session.user.id,
            notes: notes || 'Borrowed via QR scan'
          }
        });
        await prisma.book.update({
          where: { id: bookId },
          data: { available: { decrement: 1 } }
        });
        return res.json({
          success: true,
          message: `Book borrowed successfully. Due: ${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString()}`
        });
      }
    }

    // --- DEFAULT: return user info ---
    const response = {
      success: true,
      user: {
        id: user.id,
        idNumber: user.idNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        school: user.school,
        avatar: user.avatar,
        isActive: user.isActive,
        grade: user.student?.grade || null,
        section: user.student?.section || null,
        tuitionStatus: user.student?.tuitionStatus || null,
        subject: user.teacher?.subject || null,
        walletBalance: user.parent?.wallet?.balance || 0
      }
    };

    res.json(response);
  } catch (error) {
    console.error('QR scan error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- PUBLIC API: Get active borrows for a student (for scanner UI) ---
app.get('/api/student/:token/active-borrows', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await prisma.user.findUnique({
      where: { qrToken: token },
      include: { student: true }
    });

    if (!user || !user.student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const activeBorrows = await prisma.libraryTransaction.findMany({
      where: {
        studentId: user.student.id,
        action: 'borrow',
        returnedAt: null
      },
      include: { book: true }
    });

    res.json({ success: true, activeBorrows });
  } catch (error) {
    console.error('Active borrows error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================================================
// Main routes
// ============================================================
app.use('/auth', authRoutes);
app.use('/student', studentRoutes);
app.use('/teacher', teacherRoutes);
app.use('/admin', adminRoutes);
app.use('/parent', parentRoutes);
app.use('/accountant', accountantRoutes);
app.use('/cashier', cashierRoutes);

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