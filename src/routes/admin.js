const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { uploadProfile } = require('../utils/fileUpload');

const { 
  isAuthenticated, 
  isAdmin, 
  restrictToSchool, 
  setSchoolContext
} = require('../middleware/auth');
const { uploadProfile, uploadSingle, uploadProfileSingle } = require('../utils/fileUpload');
const prisma = require('../config/database');
const { hashPassword, comparePassword } = require('../utils/passwordUtils');

// Format time ago utility function (missing in original code)
const formatTimeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = seconds / 31536000;
  
  if (interval > 1) {
    return Math.floor(interval) + ' years ago';
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    return Math.floor(interval) + ' months ago';
  }
  interval = seconds / 86400;
  if (interval > 1) {
    return Math.floor(interval) + ' days ago';
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + ' hours ago';
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + ' minutes ago';
  }
  return Math.floor(seconds) + ' seconds ago';
};

router.use(express.urlencoded({ extended: true }));
router.use(express.json());

// Apply school-based access control to ALL admin routes
router.use(isAuthenticated, isAdmin, setSchoolContext, restrictToSchool);

// =============================================
// DASHBOARD & ANALYTICS ROUTES
// =============================================
router.get('/dashboard', adminController.dashboard);
router.get('/analytics', adminController.analytics);
router.get('/activities', adminController.activitiesLog);

// Analytics data routes with school filtering
router.get('/analytics-data', adminController.getAnalyticsData);
router.get('/grades-data', adminController.getGradesData);
router.get('/activities-data', adminController.getActivitiesData);

// =============================================
// USER MANAGEMENT ROUTES
// =============================================
router.get('/users', adminController.manageUsers);
router.post('/users/create', uploadProfileSingle('avatar'), adminController.createUser);
router.get('/users/:userId', adminController.getUser);
router.put('/users/:userId', uploadSingle('avatar'), adminController.updateUser);
router.patch('/users/:userId/toggle-status', adminController.toggleUserStatus);
router.get('/users/check-id/:idNumber', adminController.checkIdNumber);

// NEW: Available students route for filtering
router.get('/students/available', adminController.getAvailableStudents);

// =============================================
// CLASS MANAGEMENT ROUTES
// =============================================
router.get('/classes', adminController.manageClasses);
router.post('/classes/create', adminController.createClass);
router.get('/classes/:classId/edit', adminController.getClass);
router.put('/classes/:classId/update', adminController.updateClass); // Changed from POST to PUT
router.delete('/classes/:classId/delete', adminController.deleteClass);
router.get('/classes/:classId/students', adminController.viewClassStudents);
router.get('/classes/:classId/students-data', adminController.getClassStudents);

// Class enrollment routes
router.get('/classes/:classId/enroll', adminController.getEnrollStudents);
router.post('/classes/:classId/enroll', adminController.enrollStudents);
router.delete('/classes/:classId/enroll/:studentId', adminController.removeStudent);

// =============================================
// TUITION MANAGEMENT ROUTES
// =============================================
router.get('/tuition', adminController.manageTuition);
router.post('/tuition/record-payment', adminController.recordPayment);

// Student tuition routes
router.get('/students/:studentId/tuition', adminController.getStudentTuition);
router.put('/students/:studentId/tuition', adminController.updateStudentTuition);
router.post('/students/:studentId/extend-access', adminController.extendAccess);

// Password management
router.post('/students/:studentId/reset-password', adminController.resetStudentPassword);
router.get('/tuition/check-expiry', adminController.checkPasswordExpiry);

// =============================================
// PARENT MANAGEMENT ROUTES
// =============================================

// Student parent routes  
router.get('/students/:studentId/parent', adminController.getStudentParent);
router.get('/students/:studentId/parent-info', adminController.getStudentParentInfo);
router.post('/students/:studentId/link-parent', adminController.linkExistingParent);
router.post('/students/:studentId/create-parent', adminController.createNewParent);
router.post('/students/:studentId/unlink-parent', adminController.unlinkParent);

// Parent account routes
router.get('/parents/:parentId/account', adminController.getParentAccount);
router.post('/parents/:parentId/add-funds', adminController.addWalletFunds);
router.post('/parents/:parentId/unlink-student', adminController.unlinkStudent);

// Available parents route
router.get('/parents/available', adminController.getAvailableParents);

// =============================================
// SCHOOL MANAGEMENT ROUTES (Super Admin Only)
// =============================================
router.get('/schools', adminController.manageSchools);

// =============================================
// NOTIFICATION ROUTES
// =============================================
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

// =============================================
// DEBUG & TESTING ROUTES (Remove in production)
// =============================================

// Test database connection
router.get('/test-db', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { 
        id: true, 
        idNumber: true, 
        firstName: true, 
        lastName: true,
        password: true 
      },
      take: 5
    });
    res.json({ success: true, users });
  } catch (error) {
    console.error('Database error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Create test user with known password
router.get('/create-test-user', async (req, res) => {
  try {
    const testPassword = 'test123';
    const hashedPassword = await hashPassword(testPassword);
    
    const testUser = await prisma.user.create({
      data: {
        idNumber: 'TEST001',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        email: 'test@school.edu',
        role: 'student',
        isActive: true,
        school: req.school || 'Test School', // Use school context if available
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
    
    res.json({ 
      success: true, 
      message: 'Test user created',
      credentials: {
        idNumber: 'TEST001',
        password: 'test123'
      }
    });
  } catch (error) {
    console.error('Test user creation error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Temporary route to reset user password to 12345
router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const { userId } = req.params;
    const hashedPassword = await hashPassword('12345');
    
    await prisma.user.update({
      where: { id: parseInt(userId) },
      data: { 
        password: hashedPassword,
        isTemporaryPassword: true 
      }
    });
    
    res.json({ success: true, message: 'Password reset to 12345' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

// Add this test route to verify user passwords
router.get('/test-user/:idNumber', async (req, res) => {
  try {
    const { idNumber } = req.params;
    const user = await prisma.user.findUnique({
      where: { idNumber },
      select: { id: true, idNumber: true, firstName: true, lastName: true, password: true }
    });
    
    if (!user) {
      return res.json({ success: false, message: 'User not found' });
    }
    
    const testPassword = '12345';
    const isMatch = await comparePassword(testPassword, user.password);
    
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

// Temporary route to create super admin - remove after use
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
    
    res.json({ 
      success: true, 
      message: 'Super admin created',
      credentials: {
        idNumber: 'SUPER001',
        password: 'admin123'
      }
    });
  } catch (error) {
    console.error('Create super admin error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug route for parents
router.get('/parents/debug', async (req, res) => {
  try {
    const parents = await prisma.user.findMany({
      where: { 
        role: 'parent',
        school: req.school // Filter by current school
      },
      include: {
        parent: {
          include: {
            students: true,
            wallet: true
          }
        }
      },
      take: 5
    });
    
    res.json({
      success: true,
      parents: parents,
      parentCount: parents.length,
      sampleParent: parents.length > 0 ? parents[0] : null
    });
  } catch (error) {
    console.error('Debug parents error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// System reset routes
router.get('/system-reset', adminController.systemResetPage);
router.post('/reset-payments', adminController.resetAllPayments);
router.post('/delete-users', adminController.deleteSelectedUsers);
router.post('/reset-term', adminController.resetNewTerm);

// Get recent notifications (for the notification refresh in system-reset page)
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
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });

    // Format notifications
    const formattedNotifications = notifications.map(notif => ({
      id: notif.id,
      title: notif.title,
      message: notif.message,
      icon: notif.icon,
      time: formatTimeAgo(notif.createdAt),
      read: notif.read
    }));

    res.json({
      success: true,
      notifications: formattedNotifications,
      count: notifications.length
    });
  } catch (error) {
    console.error('Get recent notifications error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Analytics data routes with school filtering
router.get('/analytics-data', adminController.getAnalyticsData);
router.get('/tuition-analytics', adminController.getTuitionAnalytics); // ADD THIS LINE
router.get('/grades-data', adminController.getGradesData);
router.get('/activities-data', adminController.getActivitiesData);

module.exports = router;