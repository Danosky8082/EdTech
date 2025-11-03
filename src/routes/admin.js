const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { 
  isAuthenticated, 
  isAdmin, 
  restrictToSchool, 
  setSchoolContext
} = require('../middleware/auth');
const { uploadProfile, uploadSingle, uploadProfileSingle } = require('../utils/fileUpload');
const prisma = require('../config/database');
const { hashPassword, comparePassword } = require('../utils/passwordUtils');

router.use(express.urlencoded({ extended: true }));
router.use(express.json());

// Apply school-based access control to ALL admin routes
router.use(isAuthenticated, isAdmin, setSchoolContext, restrictToSchool);

// Admin dashboard with school filtering
router.get('/dashboard', adminController.dashboard);

// Class enrollment routes
router.get('/classes/:classId/enroll', adminController.getEnrollStudents);
router.post('/classes/:classId/enroll', adminController.enrollStudents);
router.delete('/classes/:classId/enroll/:studentId', adminController.removeStudent);

// User management with school filtering
router.get('/users', adminController.manageUsers);
router.post('/users/create', uploadProfileSingle('avatar'), adminController.createUser);
router.get('/users/:userId', adminController.getUser);
router.put('/users/:userId', uploadSingle('avatar'), adminController.updateUser);
router.patch('/users/:userId/toggle-status', adminController.toggleUserStatus);

// Class management with school filtering
router.get('/classes', adminController.manageClasses);
router.post('/classes/create', adminController.createClass);

// Analytics routes with school filtering
router.get('/analytics', adminController.analytics);
router.get('/activities', adminController.activitiesLog);

// Class management routes with school filtering
router.get('/classes/:classId/edit', adminController.getClass);
router.post('/classes/:classId/update', adminController.updateClass);
router.delete('/classes/:classId/delete', adminController.deleteClass);
router.get('/classes/:classId/students', adminController.viewClassStudents);

// Mark all notifications as read
router.post('/notifications/mark-all-read', async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { read: false }, // only update unread notifications
      data: { read: true }
    });

    return res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error("Error marking notifications as read:", error);
    return res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
  }
});

// Analytics data routes with school filtering
router.get('/analytics-data', adminController.getAnalyticsData);
router.get('/grades-data', adminController.getGradesData);
router.get('/activities-data', adminController.getActivitiesData);

// Tuition management routes with school filtering
router.get('/tuition', adminController.manageTuition);
router.post('/tuition/record-payment', adminController.recordPayment);
router.post('/students/:studentId/reset-password', adminController.resetStudentPassword);
router.get('/tuition/check-expiry', adminController.checkPasswordExpiry);

// Student tuition management routes with school filtering
router.get('/students/:studentId/tuition', adminController.getStudentTuition);
router.put('/students/:studentId/tuition', adminController.updateStudentTuition);
router.post('/students/:studentId/extend-access', adminController.extendAccess);

router.get('/schools', adminController.manageSchools);

// To check ID number availability
router.get('/users/check-id/:idNumber', adminController.checkIdNumber);

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
        school: 'Test School',
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
    
    // Test password comparison
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
        school: null, // Super admin has no school
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

module.exports = router;