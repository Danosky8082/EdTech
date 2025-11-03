const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacherController');
const { isAuthenticated, isTeacher, setSchoolContext } = require('../middleware/auth'); // Updated import
const { uploadMaterialSingle } = require('../middleware/upload');

// Apply school context to all teacher routes
router.use(isAuthenticated, isTeacher, setSchoolContext); // Updated middleware

// Teacher dashboard
router.get('/dashboard', teacherController.dashboard);

// Class routes
router.get('/classes', teacherController.getClasses);

// Single class with students
router.get('/class/:id', teacherController.getClassById);
router.get('/class/:id/students', teacherController.getClassStudents);

// Assignment routes
router.get('/assignments', teacherController.getAssignments);
router.get('/assignments/:id', teacherController.getAssignmentById);
router.post('/assignments/create', teacherController.createAssignment);
router.put('/assignments/update/:id', teacherController.updateAssignment);
router.delete('/assignments/delete/:id', teacherController.deleteAssignment);

// Grading routes
router.get('/grading', teacherController.getGrading);
router.get('/grading/:id', teacherController.getGradingItemById);
router.post('/grading/:submissionId', teacherController.gradeAssignment);

// Exam routes
router.get('/exams', teacherController.getExams);
router.post('/exams/create', teacherController.createExam);

// Material routes
router.get('/materials', teacherController.getMaterials);
router.post('/materials/upload', isAuthenticated, isTeacher, uploadMaterialSingle('materialFile'), teacherController.uploadMaterial);
router.delete('/materials/:id', teacherController.deleteMaterial);
router.get('/download/material/:materialId', teacherController.downloadMaterial);

// For Students (all students)
router.get('/students', teacherController.getStudents);

// Individual exam management routes
router.get('/exam/:id', teacherController.getExamById);
router.get('/exam/:id/edit', teacherController.getExamEdit);
router.get('/exam/:id/results', teacherController.getExamResults);
router.post('/exam/:id/update', teacherController.updateExam);

// Exam grading routes
router.get('/exams/grading', teacherController.viewExamsForGrading);
router.get('/exams/attempts/:attemptId/grade', teacherController.gradeExamAttempt);
router.post('/api/exams/attempts/:attemptId/grade', teacherController.submitGrading);
router.post('/api/exams/:examId/publish-results', teacherController.publishResults);

// Upload exam questions from file
const { uploadSingle } = require('../middleware/upload');
router.post('/api/exams/upload-questions', isAuthenticated, isTeacher, uploadSingle('questionsFile'), teacherController.uploadExamQuestions);

// Template download routes
router.get('/templates/questions-template.csv', isAuthenticated, isTeacher, (req, res) => {
  const csvContent = `type,question,option1,option2,option3,option4,correctAnswer,marks
multiple_choice,"What is 2+2?",3,4,5,6,1,1
multiple_choice,"What is the capital of France?","London","Berlin","Paris","Madrid",2,1
true_false,"The sky is blue.",,,,true,1
short_answer,"What is the chemical symbol for water?",,,,H2O,1
multiple_choice,"Which planet is known as the Red Planet?","Earth","Mars","Jupiter","Venus",1,2`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=questions-template.csv');
  res.send(csvContent);
});

router.get('/templates/questions-template.json', isAuthenticated, isTeacher, (req, res) => {
  const jsonContent = [
    {
      "type": "multiple_choice",
      "question": "What is 2+2?",
      "options": ["3", "4", "5", "6"],
      "correctAnswer": 1,
      "marks": 1
    },
    {
      "type": "multiple_choice",
      "question": "What is the capital of France?",
      "options": ["London", "Berlin", "Paris", "Madrid"],
      "correctAnswer": 2,
      "marks": 1
    },
    {
      "type": "true_false",
      "question": "The sky is blue.",
      "correctAnswer": true,
      "marks": 1
    },
    {
      "type": "short_answer",
      "question": "What is the chemical symbol for water?",
      "correctAnswer": "H2O",
      "marks": 1
    }
  ];

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=questions-template.json');
  res.send(JSON.stringify(jsonContent, null, 2));
});

module.exports = router;