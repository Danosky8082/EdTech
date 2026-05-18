const express = require('express');
const teacherRouter = express.Router();
const teacherController = require('../controllers/teacherController');
const { upload } = require('../middleware/upload');
const { isAuthenticated, isTeacher, setSchoolContext } = require('../middleware/auth');
const prisma = require('../config/database'); 
const multer = require('multer'); // <-- ADDED for memory storage

// Memory storage for question file parsing (5MB limit)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
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
// NEW: Parse uploaded .txt/.docx file and return plain text for assignment description
teacherRouter.post(
  '/assignments/parse-description',
  memoryUpload.single('descriptionFile'),
  teacherController.parseAssignmentDescription
);

// ========== EXAM ROUTES ==========
teacherRouter.get('/exams', teacherController.viewExams);
teacherRouter.get('/exams/create', teacherController.createExamForm);
teacherRouter.post('/exams/create', teacherController.createExam);

// NEW: Parse uploaded .txt or .docx file and return questions as JSON
teacherRouter.post(
  '/exams/parse-questions',
  memoryUpload.single('questionsFile'),
  teacherController.parseExamQuestions
);

teacherRouter.get('/exam/:id', teacherController.viewExam);
teacherRouter.get('/exam/:id/results', teacherController.viewExamResults);

// ========== MATERIAL ROUTES ==========
// Material statistics API
teacherRouter.get('/api/material-stats', teacherController.getMaterialStats);

// Update material route – KEEP ONLY THIS ONE (the duplicate later is removed)
teacherRouter.put('/materials/:id/update', teacherController.updateMaterial);

// Track material download
teacherRouter.post('/api/materials/:id/track-download', async (req, res) => {
  try {
    const materialId = req.params.id;
    
    // You could track downloads in a separate table
    // For now, we'll just acknowledge the request
    res.json({
      success: true,
      message: 'Download tracked'
    });
  } catch (error) {
    console.error('Error tracking download:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track download'
    });
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

teacherRouter.get('/debug/session-check', (req, res) => {
  console.log('🔍 Session check:', {
    session: req.session,
    user: req.session.user,
    teacherId: req.session.user?.teacherId,
    params: req.params,
    body: req.body
  });
  
  res.json({
    success: true,
    session: {
      user: req.session.user,
      teacherId: req.session.user?.teacherId
    }
  });
});

// Add this route BEFORE the POST route
teacherRouter.get('/grading/:id', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submissionId = req.params.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log('📄 Viewing single submission:', submissionId);

    const submission = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        assignment: {
          teacherId: teacherId
        }
      },
      include: {
        assignment: {
          include: {
            class: true,
            teacher: {
              include: {
                user: true
              }
            }
          }
        },
        student: {
          include: {
            user: true
          }
        }
      }
    });

    if (!submission) {
      req.flash('error', 'Submission not found');
      return res.redirect('/teacher/assignments');
    }

    res.render('teacher/view-submission', {
      title: `Submission: ${submission.assignment.title}`,
      submission: submission,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('Error viewing submission:', error);
    req.flash('error', 'Failed to load submission');
    res.redirect('/teacher/assignments');
  }
});

// ========== GRADING ROUTES ==========
// REORDERED TO PREVENT CONFLICTS:
teacherRouter.get('/grading', teacherController.viewGrading);
teacherRouter.post('/grading/:submissionId', teacherController.submitGrade); // Submit grade for a submission

// API Routes for regrading functionality (these should come AFTER specific routes)
teacherRouter.get('/api/grading/:id/details', async (req, res) => {
    // Add this route for regrade functionality
    try {
        const teacherId = req.session.user.teacherId;
        const submissionId = req.params.id;
        
        const submission = await prisma.submission.findFirst({
            where: { 
                id: submissionId,
                assignment: {
                    teacherId: teacherId
                }
            },
            include: {
                assignment: {
                    include: {
                        class: true
                    }
                },
                student: {
                    include: { 
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                idNumber: true
                            }
                        }
                    }
                }
            }
        });
        
        if (!submission) {
            return res.status(404).json({ 
                success: false, 
                message: 'Submission not found or unauthorized' 
            });
        }
        
        res.json({ 
            success: true, 
            submission: {
                id: submission.id,
                grade: submission.grade,  // Changed from 'score' to 'grade'
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
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + error.message 
        });
    }
});

teacherRouter.put('/api/grading/:id/update', async (req, res) => {
    // Update grade route - using 'grade' field instead of 'score'
    try {
        const teacherId = req.session.user.teacherId;
        const submissionId = req.params.id;
        const { score, feedback } = req.body;
        
        // Update the submission
        const updatedSubmission = await prisma.submission.updateMany({
            where: {
                id: submissionId,
                assignment: {
                    teacherId: teacherId
                }
            },
            data: {
                grade: parseFloat(score),  // Changed from 'score' to 'grade'
                feedback: feedback,
                gradedAt: new Date()
            }
        });
        
        if (updatedSubmission.count === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Submission not found or unauthorized' 
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Grade updated successfully' 
        });
    } catch (error) {
        console.error('Error updating grade:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update grade: ' + error.message 
        });
    }
});


// teacherRouter.get('/grading/:id', teacherController.gradeAssignment);

// ========== CLASS WORKS ROUTES ==========
teacherRouter.get('/class-works', teacherController.viewClassWorks);
teacherRouter.get('/class-works/create', teacherController.createClassWorkForm);
teacherRouter.post('/class-works', teacherController.createClassWork);
teacherRouter.get('/class-works/:id/edit', teacherController.editClassWorkForm);
teacherRouter.put('/class-works/:id', teacherController.updateClassWork);
teacherRouter.delete('/class-works/:id', teacherController.deleteClassWork);
teacherRouter.get('/class-works/:id/submissions', teacherController.viewSubmissions);
// NEW: Parse uploaded .txt/.docx file and return questions JSON for class work
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

// Test route
teacherRouter.get('/test', (req, res) => {
    console.log('✅ Teacher test route working');
    res.json({ success: true, message: 'Teacher routes are working!' });
});

teacherRouter.get('/test-health', (req, res) => {
  console.log('Health check called by:', req.session.user);
  res.json({
    success: true,
    message: 'Server is running',
    teacherId: req.session.user?.teacherId,
    timestamp: new Date().toISOString()
  });
});

// Get submission details (for modal) - Class Works submissions
teacherRouter.get('/submissions/:id', teacherController.getSubmissionDetails);

// Grade submission - Class Works submissions
teacherRouter.post('/submissions/:id/grade', teacherController.gradeSubmission);

// Add this route for debugging file access
teacherRouter.get('/debug/file/:filename', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filename = req.params.filename;
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
  const filePath = path.join(uploadsDir, filename);
  
  console.log('🔍 Debug file check:');
  console.log('  - Requested filename:', filename);
  console.log('  - Uploads directory:', uploadsDir);
  console.log('  - Full file path:', filePath);
  console.log('  - File exists:', fs.existsSync(filePath));
  
  if (fs.existsSync(filePath)) {
    res.json({
      success: true,
      message: 'File exists',
      details: {
        filename: filename,
        filePath: filePath,
        url: `/uploads/${filename}`,
        accessible: true,
        fileSize: fs.statSync(filePath).size
      }
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'File not found',
      details: {
        filename: filename,
        filePath: filePath,
        accessible: false
      }
    });
  }
});

// ========== MATERIAL ROUTES (continued) ==========
teacherRouter.get('/materials', teacherController.viewMaterials);  // HTML page
teacherRouter.get('/materials/upload', teacherController.uploadMaterialForm);
teacherRouter.post('/materials/upload', upload.single('materialFile'), teacherController.uploadMaterial);
teacherRouter.delete('/materials/:id', teacherController.deleteMaterial);

// API Routes for materials
teacherRouter.get('/api/materials/:id', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const materialId = req.params.id;

    const material = await prisma.material.findFirst({
      where: {
        id: materialId,
        teacherId: teacherId
      },
      include: {
        class: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            views: true
          }
        }
      }
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }

    res.json({
      success: true,
      material: material
    });
  } catch (error) {
    console.error('Error fetching material:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch material'
    });
  }
});

// ⚠️ DUPLICATE PUT ROUTE REMOVED – only one exists now (see line ~34)

teacherRouter.post('/api/materials/:id/track-download', async (req, res) => {
  try {
    const materialId = req.params.id;
    const userId = req.session.user.id;
    
    // Track view
    await prisma.materialView.create({
      data: {
        materialId: materialId,
        userId: userId,
        viewedAt: new Date()
      }
    });
    
    res.json({
      success: true,
      message: 'Download tracked'
    });
  } catch (error) {
    console.error('Error tracking download:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track download'
    });
  }
});

// Debug route for uploads
teacherRouter.get('/debug/uploads', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  
  const uploadsDir = path.join(__dirname, '../public/uploads/materials');
  const uploadsDir2 = path.join(__dirname, '../uploads/materials');
  
  console.log('Checking upload directories...');
  console.log('Public uploads dir:', uploadsDir, 'Exists:', fs.existsSync(uploadsDir));
  console.log('Direct uploads dir:', uploadsDir2, 'Exists:', fs.existsSync(uploadsDir2));
  
  let files1 = [], files2 = [];
  
  if (fs.existsSync(uploadsDir)) {
    files1 = fs.readdirSync(uploadsDir);
  }
  
  if (fs.existsSync(uploadsDir2)) {
    files2 = fs.readdirSync(uploadsDir2);
  }
  
  res.json({
    success: true,
    directories: {
      publicUploads: {
        path: uploadsDir,
        exists: fs.existsSync(uploadsDir),
        files: files1
      },
      directUploads: {
        path: uploadsDir2,
        exists: fs.existsSync(uploadsDir2),
        files: files2
      }
    }
  });
});

// Test upload route
teacherRouter.post('/test-upload', upload.single('testFile'), (req, res) => {
  console.log('Test upload received:');
  console.log('File:', req.file);
  console.log('Body:', req.body);
  
  if (req.file) {
    // Test if file is accessible
    const fileUrl = `/uploads/materials/${req.file.filename}`;
    res.json({
      success: true,
      message: 'Upload test successful',
      file: req.file,
      fileUrl: fileUrl,
      accessible: true
    });
  } else {
    res.json({
      success: false,
      message: 'No file uploaded'
    });
  }
});

// Add this route to debug the update
teacherRouter.get('/debug/assignment/:id', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const assignmentId = req.params.id;

    console.log('🔍 Debugging assignment:', assignmentId);

    // Check if assignment exists
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        teacherId: teacherId
      },
      include: {
        class: true
      }
    });

    if (!assignment) {
      return res.json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Check the Prisma model structure
    const modelInfo = {
      assignmentId: assignment.id,
      title: assignment.title,
      classId: assignment.classId,
      hasClassRelation: assignment.class !== null,
      class: assignment.class,
      teacherId: assignment.teacherId,
      allFields: Object.keys(assignment)
    };

    console.log('Assignment structure:', modelInfo);

    res.json({
      success: true,
      assignment: assignment,
      modelInfo: modelInfo,
      message: 'Assignment found'
    });

  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// Debug route for materials API
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

// Add debug route for submission IDs
teacherRouter.get('/debug/submission/:id', async (req, res) => {
    try {
        const teacherId = req.session.user.teacherId;
        const submissionId = req.params.id;
        
        console.log('🔍 Debug submission check:');
        console.log('  - Submission ID:', submissionId);
        console.log('  - Teacher ID:', teacherId);
        
        // Check if submission exists
        const submission = await prisma.submission.findFirst({
            where: {
                id: submissionId
            },
            include: {
                assignment: true
            }
        });
        
        res.json({
            success: true,
            submissionExists: !!submission,
            submission: submission,
            teacherOwnsAssignment: submission && submission.assignment.teacherId === teacherId,
            idsMatch: submissionId === (submission?.id || '')
        });
    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Debug route for submission model
teacherRouter.get('/debug/submission-model', async (req, res) => {
  try {
    // Try to create a test submission with grade
    const testData = {
      data: {
        assignment: {
          connect: { id: 'test-assignment-id' }
        },
        student: {
          connect: { id: 'test-student-id' }
        },
        grade: 85.5,
        feedback: 'Test feedback',
        gradedAt: new Date(),
        submittedAt: new Date()
      }
    };
    
    console.log('📋 Submission model test data:', testData);
    
    // Get the Prisma model metadata
    const modelInfo = {
      submissionFields: Object.keys(prisma.submission.fields || {}),
      availableOperations: Object.keys(prisma.submission || {}),
      modelName: 'Submission'
    };
    
    console.log('📋 Submission model info:', modelInfo);
    
    res.json({
      success: true,
      modelInfo: modelInfo,
      testData: testData
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// Direct database test
teacherRouter.post('/test-grade/:submissionId', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submissionId = req.params.submissionId;
    const { score, feedback } = req.body;
    
    console.log('🧪 Direct grade test:', { submissionId, score, feedback, teacherId });
    
    // Check if submission exists
    const submission = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        assignment: {
          teacherId: teacherId
        }
      }
    });
    
    console.log('🧪 Found submission:', submission);
    
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }
    
    // Try direct update
    const result = await prisma.submission.update({
      where: { id: submissionId },
      data: {
        grade: parseFloat(score),
        feedback: feedback,
        gradedAt: new Date()
      }
    });
    
    console.log('🧪 Update result:', result);
    
    res.json({
      success: true,
      message: 'Direct update successful',
      result: result
    });
    
  } catch (error) {
    console.error('🧪 Test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

// Add this debug route to your teacher routes
teacherRouter.get('/debug/assignment-submissions/:assignmentId', async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const assignmentId = req.params.assignmentId;

    console.log('🔍 DEBUG: Checking assignment submissions');
    console.log('Assignment ID:', assignmentId);
    console.log('Teacher ID:', teacherId);

    // Get the assignment with raw submissions
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        teacherId: teacherId
      },
      include: {
        submissions: {
          include: {
            student: {
              include: {
                user: true
              }
            }
          }
        }
      }
    });

    if (!assignment) {
      return res.json({ success: false, message: 'Assignment not found' });
    }

    console.log('📊 Assignment Title:', assignment.title);
    console.log('📊 Total Submissions:', assignment.submissions.length);

    // Log each submission's status
    assignment.submissions.forEach((submission, index) => {
      console.log(`\n📋 Submission ${index + 1}:`);
      console.log('  ID:', submission.id);
      console.log('  Student:', `${submission.student.user.firstName} ${submission.student.user.lastName}`);
      console.log('  Grade field:', submission.grade);
      console.log('  Score field:', submission.score);
      console.log('  gradedAt:', submission.gradedAt);
      console.log('  Is grade null?', submission.grade === null);
      console.log('  Is score null?', submission.score === null);
      console.log('  Should show as graded?', submission.grade !== null);
    });

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
    console.error('Debug error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = teacherRouter;