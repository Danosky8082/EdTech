const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
// ✅ Import materialsUpload (supports documents, videos, etc.)
const { materialsUpload } = require('../middleware/upload');
const { isAuthenticated, isStudent, setSchoolContext } = require('../middleware/auth');

// Apply auth and school context middleware to all routes
router.use(isAuthenticated, isStudent, setSchoolContext);

// Debug middleware to track route hits
router.use((req, res, next) => {
    console.log(`📨 Student Route Hit: ${req.method} ${req.originalUrl}`);
    console.log('Params:', req.params);
    console.log('Query:', req.query);
    next();
});

// ========== DASHBOARD & CLASS ROUTES ==========
router.get('/dashboard', studentController.dashboard);
router.get('/classes', studentController.viewClasses);

// ========== CLASS-SPECIFIC ROUTES ==========
// Class materials
router.get('/class/:classId/materials', studentController.viewMaterials);
router.get('/download/material/:materialId', studentController.downloadMaterial);

// Class assignments
router.get('/class/:classId/assignments', studentController.viewAssignments);

// Class exams
router.get('/class/:classId/exams', studentController.viewExams);

// ========== CLASS WORK & LIVE SESSION ROUTES ==========
// Class works routes
router.get('/class/:classId/class-works', studentController.viewClassWorks);
router.get('/class-works/:classWorkId/take', studentController.takeClassWork);
router.post('/class-works/:classWorkId/submit', studentController.submitClassWork);
router.get('/class-works/:classWorkId/results', studentController.viewClassWorkResults);

// Live sessions routes
router.get('/class/:classId/live-sessions', studentController.viewLiveSessions);
router.get('/live-sessions/:sessionId/join', studentController.joinLiveSession);
router.post('/live-sessions/:sessionId/leave', studentController.leaveLiveSession);
router.get('/live-sessions', studentController.viewAllLiveSessions);

// ========== ASSIGNMENT ROUTES ==========
// All assignments across classes
router.get('/assignments', studentController.viewAllAssignments);

// Enhanced assignment submission interface
router.get('/assignments/:id/submit', studentController.getSubmissionPage);
router.get('/assignments/:id/enhanced-submit', studentController.getEnhancedSubmissionPage);

// ✅ Use materialsUpload instead of upload
router.post('/assignments/:id/submit', materialsUpload.single('submissionFile'), studentController.submitAssignmentFile);
router.post('/assignments/:id/submit-enhanced', studentController.submitEnhancedAssignment);

// Legacy routes for backward compatibility
router.get('/assignments/:assignmentId/submit-text', studentController.getEnhancedSubmitAssignment);
router.post('/assignments/:assignmentId/submit-text', materialsUpload.none(), studentController.submitTextAssignment);
router.post('/assignments/:assignmentId/submit-drawing', studentController.submitDrawingAssignment);

// Original file upload submission (keep for backward compatibility)
router.get('/assignments/:assignmentId/submit', studentController.getSubmitAssignment);
router.post('/assignments/:assignmentId/submit', materialsUpload.single('submissionFile'), studentController.submitAssignment);

// ========== EXAM ROUTES ==========
router.get('/exams/:examId/take', studentController.takeExam);
router.get('/exams/:attemptId/results', studentController.viewExamResults);

// ========== GRADES ROUTES ==========
router.get('/grades', studentController.viewAllGrades);

// ========== NOTIFICATION ROUTES ==========
router.get('/notifications/recent', studentController.getRecentNotifications);
router.post('/notifications/mark-as-read', studentController.markNotificationAsRead);
router.post('/notifications/mark-all-read', studentController.markAllNotificationsAsRead);

// ========== PROGRESS & ANALYTICS ROUTES ==========
router.get('/progress', studentController.viewProgress);
router.get('/analytics', studentController.viewAnalytics);

router.get('/debug/material/:id', async (req, res) => {
  const material = await prisma.material.findUnique({ where: { id: req.params.id } });
  res.json({ fileUrl: material?.fileUrl, full: material });
});

module.exports = router;