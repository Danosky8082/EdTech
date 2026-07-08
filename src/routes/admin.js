const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { hashPassword, comparePassword } = require('../utils/passwordUtils');
const bookController = require('../controllers/bookController');

// ============================================================
// 1. SINGLE IMPORT – all needed upload middleware
// ============================================================
const { uploadProfile, uploadSingle, uploadProfileSingle } = require('../utils/fileUpload');

// ============================================================
// 2. AUTH MIDDLEWARE
// ============================================================
const { 
  isAuthenticated, 
  isAdmin, 
  restrictToSchool, 
  setSchoolContext
} = require('../middleware/auth');

// ============================================================
// 3. PRISMA – only imported once (if needed for routes)
// ============================================================
const prisma = require('../config/database');

// ============================================================
// 4. HELPER – format time ago
// ============================================================
const formatTimeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + ' years ago';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + ' months ago';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + ' days ago';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + ' hours ago';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + ' minutes ago';
  return Math.floor(seconds) + ' seconds ago';
};

// ============================================================
// 5. BODY PARSERS (global)
// ============================================================
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

// ============================================================
// 6. PUBLIC ROUTES – no authentication required
// ============================================================

/**
 * GET /api/scan/:token
 * Public endpoint to scan a QR code and retrieve user info.
 * Used by the scanner page (accessible to teachers/admins, but no auth required).
 */
router.get('/api/scan/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await prisma.user.findUnique({
      where: { qrToken: token },
      include: {
        student: {
          select: {
            grade: true,
            section: true,
            tuitionStatus: true
          }
        },
        teacher: {
          select: {
            subject: true
          }
        },
        parent: {
          select: {
            wallet: {
              select: {
                balance: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Build response (exclude password and other sensitive fields)
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
        // Role-specific data
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
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ============================================================
// 7. AUTH MIDDLEWARE (applied to all routes below)
// ============================================================
router.use(isAuthenticated, isAdmin, setSchoolContext, restrictToSchool);


router.get('/api/student/:token/active-borrows', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await prisma.user.findUnique({
      where: { qrToken: token },
      include: { student: true }
    });
    if (!user || !user.student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    const borrows = await prisma.libraryTransaction.findMany({
      where: {
        studentId: user.student.id,
        action: 'borrow',
        returnedAt: null
      },
      include: { book: true }
    });
    res.json({ success: true, borrows });
  } catch (error) {
    console.error('Error fetching active borrows:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================================================
// 8. BOOK ROUTES – MUST COME BEFORE ANY DYNAMIC ROUTES
// ============================================================
router.get('/books/available', bookController.getAvailableBooks); // ✅ specific first
router.get('/books', bookController.getBooks);                   // list
router.get('/books/:bookId', bookController.getBook);            // dynamic – must come AFTER specific
router.post('/books/create', bookController.createBook);
router.put('/books/:bookId/update', bookController.updateBook);
router.delete('/books/:bookId/delete', bookController.deleteBook);
router.get('/students/:studentId/books', bookController.getStudentBookHistory);

// ============================================================
// 9. OTHER PROTECTED ROUTES (all existing admin routes)
// ============================================================

// Dashboard & analytics
router.get('/dashboard', adminController.dashboard);
router.get('/analytics', adminController.analytics);
router.get('/activities', adminController.activitiesLog);
router.get('/analytics-data', adminController.getAnalyticsData);
router.get('/grades-data', adminController.getGradesData);
router.get('/activities-data', adminController.getActivitiesData);

// User management
router.get('/users', adminController.manageUsers);
router.post('/users/create', uploadProfileSingle('avatar'), adminController.createUser);
router.get('/users/:userId', adminController.getUser);
router.put('/users/:userId', uploadSingle('avatar'), adminController.updateUser);
router.patch('/users/:userId/toggle-status', adminController.toggleUserStatus);
router.get('/users/check-id/:idNumber', adminController.checkIdNumber);
router.get('/students/available', adminController.getAvailableStudents);

// QR routes
router.get('/users/:userId/qr', adminController.getUserQR);

// Class management
router.get('/classes', adminController.manageClasses);
router.post('/classes/create', adminController.createClass);
router.get('/classes/:classId/edit', adminController.getClass);
router.put('/classes/:classId/update', adminController.updateClass);
router.delete('/classes/:classId/delete', adminController.deleteClass);
router.get('/classes/:classId/students', adminController.viewClassStudents);
router.get('/classes/:classId/students-data', adminController.getClassStudents);
router.get('/classes/:classId/enroll', adminController.getEnrollStudents);
router.post('/classes/:classId/enroll', adminController.enrollStudents);
router.delete('/classes/:classId/enroll/:studentId', adminController.removeStudent);

// Tuition management
router.get('/tuition', adminController.manageTuition);
router.post('/tuition/record-payment', adminController.recordPayment);
router.get('/students/:studentId/tuition', adminController.getStudentTuition);
router.put('/students/:studentId/tuition', adminController.updateStudentTuition);
router.post('/students/:studentId/extend-access', adminController.extendAccess);
router.post('/students/:studentId/reset-password', adminController.resetStudentPassword);
router.get('/tuition/check-expiry', adminController.checkPasswordExpiry);

// Parent management
router.get('/students/:studentId/parent', adminController.getStudentParent);
router.get('/students/:studentId/parent-info', adminController.getStudentParentInfo);
router.post('/students/:studentId/link-parent', adminController.linkExistingParent);
router.post('/students/:studentId/create-parent', adminController.createNewParent);
router.post('/students/:studentId/unlink-parent', adminController.unlinkParent);
router.get('/parents/available', adminController.getAvailableParents);
router.get('/parents/:parentId/account', adminController.getParentAccount);
router.post('/parents/:parentId/add-funds', adminController.addWalletFunds);
router.post('/parents/:parentId/unlink-student', adminController.unlinkStudent);

// School management (super admin only)
router.get('/schools', adminController.manageSchools);

// System reset
router.get('/system-reset', adminController.systemResetPage);
router.post('/reset-payments', adminController.resetAllPayments);
router.post('/delete-users', adminController.deleteSelectedUsers);
router.post('/reset-term', adminController.resetNewTerm);

// Notifications
router.post('/notifications/mark-all-read', async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { read: false },
      data: { read: true }
    });
    return res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error("Error marking notifications as read:", error);
    return res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
  }
});

router.get('/notifications/recent', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const notifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        read: false,
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    const formattedNotifications = notifications.map(notif => ({
      id: notif.id,
      title: notif.title,
      message: notif.message,
      icon: notif.icon,
      time: formatTimeAgo(notif.createdAt),
      read: notif.read
    }));
    res.json({ success: true, notifications: formattedNotifications, count: notifications.length });
  } catch (error) {
    console.error('Get recent notifications error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Tuition analytics
router.get('/tuition-analytics', adminController.getTuitionAnalytics);

// ============================================================
// 10. DEBUG ROUTES
// ============================================================
router.get('/test-db', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, idNumber: true, firstName: true, lastName: true, password: true },
      take: 5
    });
    res.json({ success: true, users });
  } catch (error) {
    console.error('Database error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.get('/create-test-user', async (req, res) => {
  try {
    const hashedPassword = await hashPassword('test123');
    const testUser = await prisma.user.create({
      data: {
        idNumber: 'TEST001',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        email: 'test@school.edu',
        role: 'student',
        isActive: true,
        school: req.school || 'Test School',
        isTemporaryPassword: false
      }
    });
    await prisma.student.create({
      data: {
        userId: testUser.id,
        grade: '10',
        section: 'A',
        tuitionStatus: 'paid',
        canChangePassword: true
      }
    });
    res.json({ success: true, message: 'Test user created', credentials: { idNumber: 'TEST001', password: 'test123' } });
  } catch (error) {
    console.error('Test user creation error:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const { userId } = req.params;
    const hashedPassword = await hashPassword('12345');
    await prisma.user.update({
      where: { id: parseInt(userId) },
      data: { password: hashedPassword, isTemporaryPassword: true }
    });
    res.json({ success: true, message: 'Password reset to 12345' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

router.get('/test-user/:idNumber', async (req, res) => {
  try {
    const { idNumber } = req.params;
    const user = await prisma.user.findUnique({
      where: { idNumber },
      select: { id: true, idNumber: true, firstName: true, lastName: true, password: true }
    });
    if (!user) return res.json({ success: false, message: 'User not found' });
    const isMatch = await comparePassword('12345', user.password);
    res.json({
      success: true,
      user: {
        id: user.id,
        idNumber: user.idNumber,
        name: `${user.firstName} ${user.lastName}`,
        passwordMatch: isMatch,
        storedHash: user.password
      }
    });
  } catch (error) {
    console.error('Test user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/create-super-admin', async (req, res) => {
  try {
    const hashedPassword = await hashPassword('admin123');
    const superAdmin = await prisma.user.create({
      data: {
        idNumber: 'SUPER001',
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        email: 'super@admin.com',
        role: 'admin',
        school: null,
        isActive: true,
        isTemporaryPassword: false
      }
    });
    await prisma.admin.create({
      data: {
        userId: superAdmin.id,
        roleLevel: 'superadmin'
      }
    });
    res.json({ success: true, message: 'Super admin created', credentials: { idNumber: 'SUPER001', password: 'admin123' } });
  } catch (error) {
    console.error('Create super admin error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/parents/debug', async (req, res) => {
  try {
    const parents = await prisma.user.findMany({
      where: { role: 'parent', school: req.school },
      include: { parent: { include: { students: true, wallet: true } } },
      take: 5
    });
    res.json({ success: true, parents: parents, parentCount: parents.length, sampleParent: parents.length > 0 ? parents[0] : null });
  } catch (error) {
    console.error('Debug parents error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});





// School setup
router.get('/school-setup', adminController.schoolSetupPage);
router.post('/school-setup', adminController.saveSchoolSetup);
router.get('/next-id', adminController.getNextUserId);
router.get('/attendance', adminController.getAttendanceList);

module.exports = router;