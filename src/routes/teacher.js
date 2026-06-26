const express = require('express');
const teacherRouter = express.Router();
const teacherController = require('../controllers/teacherController');
const { isAuthenticated, isTeacher, setSchoolContext } = require('../middleware/auth');
const prisma = require('../config/database');
const multer = require('multer');

// ✅ Import the updated upload middlewares
const { uploadMaterial, profileUpload, upload } = require('../middleware/upload');

// Memory storage for parsing .txt/.docx files (5MB limit)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Apply auth and school context middleware to all routes
teacherRouter.use(isAuthenticated, isTeacher, setSchoolContext);

// ========== DASHBOARD ROUTES ==========
teacherRouter.get('/dashboard', teacherController.dashboard);

// ========== ASSIGNMENT ROUTES ==========
teacherRouter.get('/assignments', teacherController.viewAssignments);
teacherRouter.get('/assignments/create', teacherController.createAssignmentForm);
teacherRouter.post('/assignments/create', teacherController.createAssignment);
teacherRouter.get('/assignments/view/:id', teacherController.getAssignment);
teacherRouter.put('/assignments/:id', teacherController.updateAssignment);
teacherRouter.delete('/assignments/:id', teacherController.deleteAssignment);
teacherRouter.post(
  '/assignments/parse-description',
  memoryUpload.single('descriptionFile'),
  teacherController.parseAssignmentDescription
);

// ========== EXAM ROUTES ==========
teacherRouter.get('/exams', teacherController.viewExams);
teacherRouter.get('/exams/create', teacherController.createExamForm);
teacherRouter.post('/exams/create', teacherController.createExam);
teacherRouter.post(
  '/exams/parse-questions',
  memoryUpload.single('questionsFile'),
  teacherController.parseExamQuestions
);
teacherRouter.get('/exam/:id', teacherController.viewExam);
teacherRouter.get('/exam/:id/results', teacherController.viewExamResults);

// ========== MATERIAL ROUTES ==========
teacherRouter.get('/materials', teacherController.viewMaterials);
teacherRouter.get('/materials/upload', teacherController.uploadMaterialForm);

// ✅ FIX: Use uploadMaterial (supports documents, videos, etc.)
teacherRouter.post('/materials/upload', uploadMaterial, teacherController.uploadMaterial);

teacherRouter.delete('/materials/:id', teacherController.deleteMaterial);
teacherRouter.put('/materials/:id/update', teacherController.updateMaterial);

// API routes for materials
teacherRouter.get('/api/materials/:id', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const materialId = req.params.id;
    const material = await prisma.material.findFirst({
      where: { id: materialId, teacherId: teacherId },
      include: {
        class: { select: { id: true, name: true } },
        _count: { select: { views: true } }
      }
    });
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }
    res.json({ success: true, material });
  } catch (error) {
    console.error('Error fetching material:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch material' });
  }
});

teacherRouter.post('/api/materials/:id/track-download', async (req, res) => {
  try {
    const materialId = req.params.id;
    const userId = req.session.user.id;
    await prisma.materialView.create({
      data: {
        materialId: materialId,
        userId: userId,
        viewedAt: new Date()
      }
    });
    res.json({ success: true, message: 'Download tracked' });
  } catch (error) {
    console.error('Error tracking download:', error);
    res.status(500).json({ success: false, message: 'Failed to track download' });
  }
});

// ========== CLASS ROUTES ==========
teacherRouter.get('/classes', teacherController.viewClasses);
teacherRouter.get('/class/:id', teacherController.getClassDetails);
teacherRouter.get('/class/:id/students', teacherController.getClassStudents);

// ========== STUDENT ROUTES ==========
teacherRouter.get('/students', teacherController.viewStudents);
teacherRouter.get('/api/students/:id/profile', teacherController.getStudentProfile);
teacherRouter.get('/api/students/:id/progress', teacherController.getStudentProgress);

// ========== GRADING ROUTES ==========
teacherRouter.get('/grading', teacherController.viewGrading);
teacherRouter.post('/grading/:submissionId', teacherController.submitGrade);
teacherRouter.get('/grading/:id', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submissionId = req.params.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const submission = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        assignment: { teacherId: teacherId }
      },
      include: {
        assignment: { include: { class: true, teacher: { include: { user: true } } } },
        student: { include: { user: true } }
      }
    });

    if (!submission) {
      req.flash('error', 'Submission not found');
      return res.redirect('/teacher/assignments');
    }

    res.render('teacher/view-submission', {
      title: `Submission: ${submission.assignment.title}`,
      submission,
      userSchool,
      isSuperAdmin
    });
  } catch (error) {
    console.error('Error viewing submission:', error);
    req.flash('error', 'Failed to load submission');
    res.redirect('/teacher/assignments');
  }
});

// API routes for regrading
teacherRouter.get('/api/grading/:id/details', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submissionId = req.params.id;
    const submission = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        assignment: { teacherId: teacherId }
      },
      include: {
        assignment: { include: { class: true } },
        student: { include: { user: { select: { firstName: true, lastName: true, idNumber: true } } } }
      }
    });
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found or unauthorized' });
    }
    res.json({
      success: true,
      submission: {
        id: submission.id,
        grade: submission.grade,
        feedback: submission.feedback,
        assignment: {
          id: submission.assignment.id,
          title: submission.assignment.title,
          points: submission.assignment.points || 100,
          class: submission.assignment.class
        },
        student: submission.student
      }
    });
  } catch (error) {
    console.error('Error getting submission details:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

teacherRouter.put('/api/grading/:id/update', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submissionId = req.params.id;
    const { score, feedback } = req.body;
    const updatedSubmission = await prisma.submission.updateMany({
      where: {
        id: submissionId,
        assignment: { teacherId: teacherId }
      },
      data: {
        grade: parseFloat(score),
        feedback: feedback,
        gradedAt: new Date()
      }
    });
    if (updatedSubmission.count === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found or unauthorized' });
    }
    res.json({ success: true, message: 'Grade updated successfully' });
  } catch (error) {
    console.error('Error updating grade:', error);
    res.status(500).json({ success: false, message: 'Failed to update grade: ' + error.message });
  }
});

// ========== CLASS WORKS ROUTES ==========
teacherRouter.get('/class-works', teacherController.viewClassWorks);
teacherRouter.get('/class-works/create', teacherController.createClassWorkForm);
teacherRouter.post('/class-works', teacherController.createClassWork);
teacherRouter.get('/class-works/:id/edit', teacherController.editClassWorkForm);
teacherRouter.put('/class-works/:id', teacherController.updateClassWork);
teacherRouter.delete('/class-works/:id', teacherController.deleteClassWork);
teacherRouter.get('/class-works/:id/submissions', teacherController.viewSubmissions);
teacherRouter.post(
  '/class-works/parse-questions',
  memoryUpload.single('questionsFile'),
  teacherController.parseClassWorkQuestions
);

// ========== LIVE SESSIONS ROUTES ==========
teacherRouter.get('/live-sessions', teacherController.viewLiveSessions);
teacherRouter.get('/live-sessions/create', teacherController.createLiveSessionForm);
teacherRouter.post('/live-sessions', teacherController.createLiveSession);
teacherRouter.get('/live-sessions/:id/edit', teacherController.editLiveSessionForm);
teacherRouter.put('/live-sessions/:id', teacherController.updateLiveSession);
teacherRouter.delete('/live-sessions/:id', teacherController.deleteLiveSession);

// ========== SUBMISSION ROUTES ==========
teacherRouter.get('/submissions/:id', teacherController.getSubmissionDetails);
teacherRouter.post('/submissions/:id/grade', teacherController.gradeSubmission);

// ========== DEBUG ROUTES ==========
teacherRouter.get('/test', (req, res) => {
  res.json({ success: true, message: 'Teacher routes are working!' });
});

teacherRouter.get('/test-health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    teacherId: req.session.user?.teacherId,
    timestamp: new Date().toISOString()
  });
});

teacherRouter.get('/debug/session-check', (req, res) => {
  res.json({
    success: true,
    session: {
      user: req.session.user,
      teacherId: req.session.user?.teacherId
    }
  });
});

teacherRouter.get('/debug/file/:filename', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filename = req.params.filename;
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) {
    res.json({
      success: true,
      message: 'File exists',
      details: {
        filename,
        filePath,
        url: `/uploads/${filename}`,
        accessible: true,
        fileSize: fs.statSync(filePath).size
      }
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'File not found',
      details: { filename, filePath, accessible: false }
    });
  }
});

teacherRouter.get('/debug/uploads', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const uploadsDir = path.join(__dirname, '../public/uploads/materials');
  const uploadsDir2 = path.join(__dirname, '../uploads/materials');
  let files1 = [], files2 = [];
  if (fs.existsSync(uploadsDir)) files1 = fs.readdirSync(uploadsDir);
  if (fs.existsSync(uploadsDir2)) files2 = fs.readdirSync(uploadsDir2);
  res.json({
    success: true,
    directories: {
      publicUploads: { path: uploadsDir, exists: fs.existsSync(uploadsDir), files: files1 },
      directUploads: { path: uploadsDir2, exists: fs.existsSync(uploadsDir2), files: files2 }
    }
  });
});

// Test upload route (use uploadMaterial for consistency)
teacherRouter.post('/test-upload', uploadMaterial, (req, res) => {
  if (req.file) {
    const fileUrl = `/uploads/materials/${req.file.filename}`;
    res.json({
      success: true,
      message: 'Upload test successful',
      file: req.file,
      fileUrl,
      accessible: true
    });
  } else {
    res.json({ success: false, message: 'No file uploaded' });
  }
});

teacherRouter.get('/debug/assignment/:id', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const assignmentId = req.params.id;
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, teacherId: teacherId },
      include: { class: true }
    });
    if (!assignment) {
      return res.json({ success: false, message: 'Assignment not found' });
    }
    res.json({
      success: true,
      assignment,
      modelInfo: {
        assignmentId: assignment.id,
        title: assignment.title,
        classId: assignment.classId,
        hasClassRelation: assignment.class !== null,
        class: assignment.class,
        teacherId: assignment.teacherId,
        allFields: Object.keys(assignment)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

teacherRouter.get('/debug/materials-api', (req, res) => {
  res.json({
    success: true,
    routes: {
      getMaterialById: 'GET /teacher/api/materials/:id',
      updateMaterial: 'PUT /teacher/materials/:id/update',
      deleteMaterial: 'DELETE /teacher/materials/:id',
      uploadMaterial: 'POST /teacher/materials/upload',
      viewMaterials: 'GET /teacher/materials'
    },
    session: req.session.user,
    teacherId: req.session.user?.teacherId
  });
});

teacherRouter.get('/debug/submission/:id', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submissionId = req.params.id;
    const submission = await prisma.submission.findFirst({
      where: { id: submissionId },
      include: { assignment: true }
    });
    res.json({
      success: true,
      submissionExists: !!submission,
      submission,
      teacherOwnsAssignment: submission && submission.assignment.teacherId === teacherId,
      idsMatch: submissionId === (submission?.id || '')
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

teacherRouter.get('/debug/submission-model', async (req, res) => {
  res.json({
    success: true,
    modelInfo: {
      submissionFields: Object.keys(prisma.submission.fields || {}),
      availableOperations: Object.keys(prisma.submission || {}),
      modelName: 'Submission'
    }
  });
});

teacherRouter.post('/test-grade/:submissionId', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submissionId = req.params.submissionId;
    const { score, feedback } = req.body;
    const submission = await prisma.submission.findFirst({
      where: { id: submissionId, assignment: { teacherId: teacherId } }
    });
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }
    const result = await prisma.submission.update({
      where: { id: submissionId },
      data: { grade: parseFloat(score), feedback, gradedAt: new Date() }
    });
    res.json({ success: true, message: 'Direct update successful', result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

teacherRouter.get('/debug/assignment-submissions/:assignmentId', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const assignmentId = req.params.assignmentId;
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, teacherId: teacherId },
      include: {
        submissions: {
          include: {
            student: { include: { user: true } }
          }
        }
      }
    });
    if (!assignment) {
      return res.json({ success: false, message: 'Assignment not found' });
    }
    res.json({
      success: true,
      assignment: {
        id: assignment.id,
        title: assignment.title,
        submissions: assignment.submissions.map(sub => ({
          id: sub.id,
          student: `${sub.student.user.firstName} ${sub.student.user.lastName}`,
          grade: sub.grade,
          score: sub.score,
          gradedAt: sub.gradedAt,
          status: sub.grade !== null ? 'GRADED' : 'PENDING'
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = teacherRouter;