const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const { upload } = require('../middleware/upload');
const { isAuthenticated, isStudent, setSchoolContext } = require('../middleware/auth'); // Updated import

// Apply auth and school context middleware to all routes
router.use(isAuthenticated, isStudent, setSchoolContext); // Updated middleware

// Define the missing middleware
const ensureStudentData = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'student') {
        if (!req.session.user.studentId) {
            console.log('⚠️ studentId missing from session, redirecting to login');
            return res.redirect('/auth/login');
        }
    }
    next();
};

// ========== DASHBOARD & CLASS ROUTES ==========
router.get('/dashboard', studentController.dashboard);
router.get('/classes', studentController.viewClasses);

// ========== CLASS-SPECIFIC ROUTES ==========
// Class materials
router.get('/class/:classId/materials', ensureStudentData, studentController.viewMaterials);
router.get('/download/material/:materialId', studentController.downloadMaterial);

// Class assignments
router.get('/class/:id/assignments', studentController.getClassAssignments);

// Class exams
router.get('/class/:classId/exams', studentController.viewExams);

// ========== ASSIGNMENT ROUTES ==========
// All assignments across classes
router.get('/assignments', studentController.viewAllAssignments);

// ========== ENHANCED SUBMISSION ROUTES ==========
// Enhanced assignment submission interface
router.get('/assignments/:id/submit', studentController.getSubmissionPage);
router.get('/assignments/:id/enhanced-submit', studentController.getEnhancedSubmissionPage);

// Handle submissions
router.post('/assignments/:id/submit', upload.single('submissionFile'), studentController.submitAssignmentFile);
router.post('/assignments/:id/submit-enhanced', studentController.submitEnhancedAssignment);

// Legacy routes for backward compatibility
router.get('/assignments/:assignmentId/submit-enhanced', studentController.getEnhancedSubmitAssignment);
router.post('/assignments/:assignmentId/submit-text', studentController.submitTextAssignment);
router.post('/assignments/:assignmentId/submit-drawing', studentController.submitDrawingAssignment);

// Original file upload submission (keep for backward compatibility)
router.get('/assignments/:assignmentId/submit', studentController.getSubmitAssignment);
router.post('/assignments/:assignmentId/submit', upload.single('submissionFile'), studentController.submitAssignment);

// ========== EXAM ROUTES ==========
router.get('/exams/:examId/take', studentController.takeExam);
router.get('/exams/:attemptId/results', studentController.viewExamResults);

// ========== GRADES ROUTES ==========
router.get('/grades', studentController.viewAllGrades);

// ========== API ROUTES ==========
// Exam API routes
router.get('/api/exams/:examId/questions', studentController.getExamQuestions);
router.post('/api/exams/:examId/submit', studentController.submitExam);

// Notes API routes
router.get('/api/class/:classId/notes', studentController.getNotes);
router.post('/api/class/:classId/notes', studentController.saveNote);
router.put('/api/notes/:noteId', studentController.updateNote);
router.delete('/api/notes/:noteId', studentController.deleteNote);

// Test route
router.post('/api/test-save', (req, res) => {
    console.log('🧪 Test save route called with body:', req.body);
    res.json({
        success: true,
        message: 'Test save successful',
        receivedData: req.body
    });
});

module.exports = router;