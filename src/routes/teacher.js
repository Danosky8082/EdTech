const express = require('express');
const teacherRouter = express.Router();
const teacherController = require('../controllers/teacherController');
const { isAuthenticated, isTeacher, setSchoolContext } = require('../middleware/auth');
const prisma = require('../config/database');
const multer = require('multer');

// ✅ Import materialsUpload (must match export name)
const { materialsUpload } = require('../middleware/upload');

// Memory upload for text files (5MB)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Apply auth & school context
teacherRouter.use(isAuthenticated, isTeacher, setSchoolContext);

// ========== DASHBOARD ==========
teacherRouter.get('/dashboard', teacherController.dashboard);

// ========== ASSIGNMENTS ==========
teacherRouter.get('/assignments', teacherController.viewAssignments);
teacherRouter.get('/assignments/create', teacherController.createAssignmentForm);
teacherRouter.post('/assignments/create', teacherController.createAssignment);
teacherRouter.get('/assignments/view/:id', teacherController.getAssignment);
teacherRouter.put('/assignments/:id', teacherController.updateAssignment);
teacherRouter.delete('/assignments/:id', teacherController.deleteAssignment);
teacherRouter.post('/assignments/parse-description', memoryUpload.single('descriptionFile'), teacherController.parseAssignmentDescription);

// ========== EXAMS ==========
teacherRouter.get('/exams', teacherController.viewExams);
teacherRouter.get('/exams/create', teacherController.createExamForm);
teacherRouter.post('/exams/create', teacherController.createExam);
teacherRouter.post('/exams/parse-questions', memoryUpload.single('questionsFile'), teacherController.parseExamQuestions);
teacherRouter.get('/exam/:id', teacherController.viewExam);
teacherRouter.get('/exam/:id/results', teacherController.viewExamResults);

// ========== MATERIALS ==========
teacherRouter.get('/materials', teacherController.viewMaterials);
teacherRouter.get('/materials/upload', teacherController.uploadMaterialForm);

// ✅ This is the critical line – materialsUpload is now defined
teacherRouter.post('/materials/upload', materialsUpload, teacherController.uploadMaterial);

teacherRouter.delete('/materials/:id', teacherController.deleteMaterial);
teacherRouter.put('/materials/:id/update', teacherController.updateMaterial);

// API: get material by ID
teacherRouter.get('/api/materials/:id', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const material = await prisma.material.findFirst({
      where: { id: req.params.id, teacherId },
      include: { class: { select: { id: true, name: true } }, _count: { select: { views: true } } }
    });
    if (!material) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, material });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Track download
teacherRouter.post('/api/materials/:id/track-download', async (req, res) => {
  try {
    await prisma.materialView.create({
      data: { materialId: req.params.id, userId: req.session.user.id, viewedAt: new Date() }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ========== CLASSES ==========
teacherRouter.get('/classes', teacherController.viewClasses);
teacherRouter.get('/class/:id', teacherController.getClassDetails);
teacherRouter.get('/class/:id/students', teacherController.getClassStudents);

// ========== STUDENTS ==========
teacherRouter.get('/students', teacherController.viewStudents);
teacherRouter.get('/api/students/:id/profile', teacherController.getStudentProfile);
teacherRouter.get('/api/students/:id/progress', teacherController.getStudentProgress);

// ========== GRADING ==========
teacherRouter.get('/grading', teacherController.viewGrading);
teacherRouter.post('/grading/:submissionId', teacherController.submitGrade);
teacherRouter.get('/grading/:id', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submission = await prisma.submission.findFirst({
      where: { id: req.params.id, assignment: { teacherId } },
      include: { assignment: { include: { class: true, teacher: { include: { user: true } } } }, student: { include: { user: true } } }
    });
    if (!submission) {
      req.flash('error', 'Submission not found');
      return res.redirect('/teacher/assignments');
    }
    res.render('teacher/view-submission', {
      title: `Submission: ${submission.assignment.title}`,
      submission,
      userSchool: req.userSchool,
      isSuperAdmin: req.isSuperAdmin
    });
  } catch (error) {
    req.flash('error', 'Failed to load submission');
    res.redirect('/teacher/assignments');
  }
});

// API: regrade details
teacherRouter.get('/api/grading/:id/details', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submission = await prisma.submission.findFirst({
      where: { id: req.params.id, assignment: { teacherId } },
      include: { assignment: { include: { class: true } }, student: { include: { user: { select: { firstName: true, lastName: true, idNumber: true } } } } }
    });
    if (!submission) return res.status(404).json({ success: false });
    res.json({ success: true, submission: { id: submission.id, grade: submission.grade, feedback: submission.feedback, assignment: { id: submission.assignment.id, title: submission.assignment.title, points: submission.assignment.points || 100, class: submission.assignment.class }, student: submission.student } });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// API: update grade
teacherRouter.put('/api/grading/:id/update', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const { score, feedback } = req.body;
    const result = await prisma.submission.updateMany({
      where: { id: req.params.id, assignment: { teacherId } },
      data: { grade: parseFloat(score), feedback, gradedAt: new Date() }
    });
    if (result.count === 0) return res.status(404).json({ success: false });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ========== CLASS WORKS ==========
teacherRouter.get('/class-works', teacherController.viewClassWorks);
teacherRouter.get('/class-works/create', teacherController.createClassWorkForm);
teacherRouter.post('/class-works', teacherController.createClassWork);
teacherRouter.get('/class-works/:id/edit', teacherController.editClassWorkForm);
teacherRouter.put('/class-works/:id', teacherController.updateClassWork);
teacherRouter.delete('/class-works/:id', teacherController.deleteClassWork);
teacherRouter.get('/class-works/:id/submissions', teacherController.viewSubmissions);
teacherRouter.post('/class-works/parse-questions', memoryUpload.single('questionsFile'), teacherController.parseClassWorkQuestions);

// ========== LIVE SESSIONS ==========
teacherRouter.get('/live-sessions', teacherController.viewLiveSessions);
teacherRouter.get('/live-sessions/create', teacherController.createLiveSessionForm);
teacherRouter.post('/live-sessions', teacherController.createLiveSession);
teacherRouter.get('/live-sessions/:id/edit', teacherController.editLiveSessionForm);
teacherRouter.put('/live-sessions/:id', teacherController.updateLiveSession);
teacherRouter.delete('/live-sessions/:id', teacherController.deleteLiveSession);

// ========== SUBMISSIONS ==========
teacherRouter.get('/submissions/:id', teacherController.getSubmissionDetails);
teacherRouter.post('/submissions/:id/grade', teacherController.gradeSubmission);

// ========== DEBUG ==========
teacherRouter.get('/test', (req, res) => res.json({ success: true, message: 'Teacher routes working' }));
teacherRouter.get('/test-health', (req, res) => res.json({ success: true, teacherId: req.session.user?.teacherId, timestamp: new Date() }));
teacherRouter.get('/debug/session-check', (req, res) => res.json({ success: true, session: req.session }));
teacherRouter.get('/debug/file/:filename', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, '../../uploads', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.json({ success: true, file: req.params.filename, path: filePath, size: fs.statSync(filePath).size });
  } else {
    res.status(404).json({ success: false, message: 'File not found' });
  }
});
teacherRouter.get('/debug/uploads', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const dirs = ['public/uploads/materials', 'uploads/materials'].map(d => path.join(__dirname, '../../', d));
  const result = dirs.map(d => ({ path: d, exists: fs.existsSync(d), files: fs.existsSync(d) ? fs.readdirSync(d) : [] }));
  res.json({ success: true, directories: result });
});
teacherRouter.post('/test-upload', materialsUpload, (req, res) => {
  if (req.file) {
    res.json({ success: true, file: req.file, url: `/uploads/materials/${req.file.filename}` });
  } else {
    res.json({ success: false, message: 'No file' });
  }
});
teacherRouter.get('/debug/assignment/:id', async (req, res) => {
  try {
    const assignment = await prisma.assignment.findFirst({ where: { id: req.params.id, teacherId: req.session.user.teacherId }, include: { class: true } });
    res.json({ success: true, assignment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
teacherRouter.get('/debug/materials-api', (req, res) => res.json({ success: true, routes: ['GET /api/materials/:id', 'PUT /materials/:id/update', 'DELETE /materials/:id', 'POST /materials/upload', 'GET /materials'] }));
teacherRouter.get('/debug/submission/:id', async (req, res) => {
  const submission = await prisma.submission.findFirst({ where: { id: req.params.id }, include: { assignment: true } });
  res.json({ success: true, submission });
});
teacherRouter.get('/debug/submission-model', (req, res) => res.json({ success: true, model: 'Submission' }));
teacherRouter.post('/test-grade/:submissionId', async (req, res) => {
  try {
    const { score, feedback } = req.body;
    const result = await prisma.submission.update({
      where: { id: req.params.submissionId },
      data: { grade: parseFloat(score), feedback, gradedAt: new Date() }
    });
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
teacherRouter.get('/debug/assignment-submissions/:assignmentId', async (req, res) => {
  try {
    const assignment = await prisma.assignment.findFirst({
      where: { id: req.params.assignmentId, teacherId: req.session.user.teacherId },
      include: { submissions: { include: { student: { include: { user: true } } } } }
    });
    if (!assignment) return res.json({ success: false, message: 'Not found' });
    res.json({ success: true, assignment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = teacherRouter;