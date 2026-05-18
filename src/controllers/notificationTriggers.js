const { 
  createAssignmentNotification,
  createMaterialNotification,
  createGradeNotification,
  createExamNotification,
  createAnnouncementNotification 
} = require('../services/notificationService');

// Trigger assignment notification
exports.notifyStudentsAboutAssignment = async (req, res) => {
  try {
    const { classId, title, dueDate, teacherId, teacherName } = req.body;
    const assignmentId = req.params.assignmentId || req.body.assignmentId;

    const result = await createAssignmentNotification({
      assignmentId,
      classId,
      title,
      dueDate,
      teacherId,
      teacherName
    });

    res.json(result);
  } catch (error) {
    console.error('Error triggering assignment notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Trigger material notification
exports.notifyStudentsAboutMaterial = async (req, res) => {
  try {
    const { classId, title, description, teacherId, teacherName, materialType } = req.body;
    const materialId = req.params.materialId || req.body.materialId;

    const result = await createMaterialNotification({
      materialId,
      classId,
      title,
      description,
      teacherId,
      teacherName,
      materialType
    });

    res.json(result);
  } catch (error) {
    console.error('Error triggering material notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Trigger grade notification
exports.notifyStudentAboutGrade = async (req, res) => {
  try {
    const { studentId, assignmentId, assignmentTitle, grade, totalPoints, teacherName } = req.body;

    const result = await createGradeNotification({
      studentId,
      assignmentId,
      assignmentTitle,
      grade,
      totalPoints,
      teacherName
    });

    res.json(result);
  } catch (error) {
    console.error('Error triggering grade notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Trigger exam notification
exports.notifyStudentsAboutExam = async (req, res) => {
  try {
    const { classId, title, examDate, duration, teacherName } = req.body;
    const examId = req.params.examId || req.body.examId;

    const result = await createExamNotification({
      examId,
      classId,
      title,
      examDate,
      duration,
      teacherName
    });

    res.json(result);
  } catch (error) {
    console.error('Error triggering exam notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Trigger announcement notification
exports.notifyUsersAboutAnnouncement = async (req, res) => {
  try {
    const { userIds, title, content, createdBy } = req.body;
    const announcementId = req.params.announcementId || req.body.announcementId;

    const result = await createAnnouncementNotification({
      announcementId,
      title,
      content,
      userIds,
      createdBy
    });

    res.json(result);
  } catch (error) {
    console.error('Error triggering announcement notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};