const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const { materialsUpload } = require('../middleware/upload');
const { isAuthenticated, isStudent, setSchoolContext } = require('../middleware/auth');
const checkStudentPayment = require('../middleware/checkStudentPayment');
const prisma = require('../config/database'); // for debug route

// Apply auth and school context middleware to all routes
router.use(isAuthenticated, isStudent, setSchoolContext);

// Debug middleware to track route hits (enhanced)
router.use((req, res, next) => {
    console.log(`📨 Student Route Hit: ${req.method} ${req.originalUrl}`);
    console.log('Params:', req.params);
    console.log('Query:', req.query);
    next();
});

// ========== DASHBOARD & CLASS ROUTES ==========
router.get('/dashboard', studentController.dashboard);
router.get('/classes', checkStudentPayment, studentController.viewClasses);

// ========== CLASS-SPECIFIC ROUTES ==========
router.get('/class/:classId/materials', checkStudentPayment, studentController.viewMaterials);
router.get('/download/material/:materialId', checkStudentPayment, studentController.downloadMaterial);
router.get('/class/:classId/assignments', checkStudentPayment, studentController.viewAssignments);
router.get('/class/:classId/exams', checkStudentPayment, studentController.viewExams);

// ========== CLASS WORK & LIVE SESSION ROUTES ==========
router.get('/class/:classId/class-works', checkStudentPayment, studentController.viewClassWorks);
router.get('/class-works/:classWorkId/take', checkStudentPayment, studentController.takeClassWork);
router.post('/class-works/:classWorkId/submit', checkStudentPayment, studentController.submitClassWork);
router.get('/class-works/:classWorkId/results', checkStudentPayment, studentController.viewClassWorkResults);
router.get('/class/:classId/live-sessions', checkStudentPayment, studentController.viewLiveSessions);
router.get('/live-sessions/:sessionId/join', checkStudentPayment, studentController.joinLiveSession);
router.post('/live-sessions/:sessionId/leave', checkStudentPayment, studentController.leaveLiveSession);
router.get('/live-sessions', checkStudentPayment, studentController.viewAllLiveSessions);

// ========== ASSIGNMENT ROUTES ==========
router.get('/assignments', checkStudentPayment, studentController.viewAllAssignments);
router.get('/assignments/:id/submit', checkStudentPayment, studentController.getSubmissionPage);
router.get('/assignments/:id/enhanced-submit', checkStudentPayment, studentController.getEnhancedSubmissionPage);
router.post('/assignments/:id/submit', checkStudentPayment, materialsUpload.single('submissionFile'), studentController.submitAssignmentFile);
router.post('/assignments/:id/submit-enhanced', checkStudentPayment, studentController.submitEnhancedAssignment);
router.get('/assignments/:assignmentId/submit-text', checkStudentPayment, studentController.getEnhancedSubmitAssignment);
router.post('/assignments/:assignmentId/submit-text', checkStudentPayment, materialsUpload.none(), studentController.submitTextAssignment);
router.post('/assignments/:assignmentId/submit-drawing', checkStudentPayment, studentController.submitDrawingAssignment);
router.get('/assignments/:assignmentId/submit', checkStudentPayment, studentController.getSubmitAssignment);
router.post('/assignments/:assignmentId/submit', checkStudentPayment, materialsUpload.single('submissionFile'), studentController.submitAssignment);

// ========== EXAM ROUTES ==========
router.get('/exams/:examId/take', checkStudentPayment, studentController.takeExam);
router.get('/exams/:attemptId/results', checkStudentPayment, studentController.viewExamResults);

// ========== GRADES ROUTES ==========
router.get('/grades', checkStudentPayment, studentController.viewAllGrades);

// ========== NOTIFICATION ROUTES (unprotected – allow notifications) ==========
router.get('/notifications/recent', studentController.getRecentNotifications);
router.post('/notifications/mark-as-read', studentController.markNotificationAsRead);
router.post('/notifications/mark-all-read', studentController.markAllNotificationsAsRead);

// ========== PROGRESS & ANALYTICS ROUTES ==========
router.get('/progress', checkStudentPayment, studentController.viewProgress);
router.get('/analytics', checkStudentPayment, studentController.viewAnalytics);

// Debug route (optional)
router.get('/debug/material/:id', async (req, res) => {
    const material = await prisma.material.findUnique({ where: { id: req.params.id } });
    res.json({ fileUrl: material?.fileUrl, full: material });
});

module.exports = router;