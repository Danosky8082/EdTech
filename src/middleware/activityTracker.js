const activityNotificationService = require('../services/activityNotificationService');

const activityTracker = (options = {}) => {
  return async (req, res, next) => {
    // Store the original send function
    const originalSend = res.send;
    
    // Override the send function
    res.send = function(data) {
      try {
        // Only track successful POST/PUT/DELETE requests
        if (req.method !== 'GET' && res.statusCode >= 200 && res.statusCode < 300) {
          // Parse the response data if it's JSON
          let responseData;
          try {
            responseData = typeof data === 'string' ? JSON.parse(data) : data;
          } catch (e) {
            responseData = data;
          }

          // Track different activity types based on route
          trackActivity(req, responseData);
        }
      } catch (error) {
        console.error('Activity tracking error:', error);
        // Don't break the response if tracking fails
      }
      
      // Call the original send function
      return originalSend.call(this, data);
    };

    next();
  };
};

async function trackActivity(req, responseData) {
  const user = req.session?.user;
  if (!user) return;

  try {
    const baseUrl = req.baseUrl || req.originalUrl;
    const method = req.method;

    // ASSIGNMENT CREATION
    if (baseUrl.includes('/assignments') && method === 'POST') {
      const assignmentData = {
        assignmentId: responseData?.id || responseData?.assignmentId,
        classId: req.body.classId,
        title: req.body.title,
        description: req.body.description,
        dueDate: req.body.dueDate,
        points: req.body.points,
        assignmentType: req.body.type,
        teacherId: user.id,
        teacherName: `${user.firstName} ${user.lastName}`
      };

      await activityNotificationService.notifyNewAssignment(assignmentData);
    }

    // MATERIAL UPLOAD
    else if (baseUrl.includes('/materials') && method === 'POST') {
      const materialData = {
        materialId: responseData?.id || responseData?.materialId,
        classId: req.body.classId,
        title: req.body.title,
        description: req.body.description,
        fileType: req.body.fileType || req.file?.mimetype,
        subject: req.body.subject,
        teacherId: user.id,
        teacherName: `${user.firstName} ${user.lastName}`
      };

      await activityNotificationService.notifyNewMaterial(materialData);
    }

    // GRADE SUBMISSION
    else if (baseUrl.includes('/grades') && method === 'POST') {
      const gradeData = {
        studentId: req.body.studentId,
        studentName: req.body.studentName || 'Student',
        assignmentId: req.body.assignmentId,
        assignmentTitle: req.body.assignmentTitle || 'Assignment',
        grade: req.body.grade,
        maxGrade: req.body.maxGrade || 100,
        percentage: req.body.percentage || (req.body.grade / (req.body.maxGrade || 100)) * 100,
        teacherId: user.id,
        teacherName: `${user.firstName} ${user.lastName}`,
        feedback: req.body.feedback
      };

      await activityNotificationService.notifyGradeSubmission(gradeData);
    }

    // EXAM CREATION
    else if (baseUrl.includes('/exams') && method === 'POST') {
      const examData = {
        examId: responseData?.id || responseData?.examId,
        classId: req.body.classId,
        title: req.body.title,
        description: req.body.description,
        examDate: req.body.examDate,
        duration: req.body.duration,
        teacherId: user.id,
        teacherName: `${user.firstName} ${user.lastName}`
      };

      await activityNotificationService.notifyNewExam(examData);
    }

    // ANNOUNCEMENT CREATION
    else if (baseUrl.includes('/announcements') && method === 'POST') {
      const announcementData = {
        announcementId: responseData?.id || responseData?.announcementId,
        title: req.body.title,
        content: req.body.content,
        targetAudience: req.body.targetAudience || 'all',
        classId: req.body.classId,
        schoolId: user.schoolId,
        createdBy: `${user.firstName} ${user.lastName}`,
        createdById: user.id
      };

      await activityNotificationService.notifyAnnouncement(announcementData);
    }

    // ATTENDANCE UPDATE
    else if (baseUrl.includes('/attendance') && method === 'POST') {
      // Handle bulk attendance update
      if (Array.isArray(req.body)) {
        for (const attendance of req.body) {
          const attendanceData = {
            studentId: attendance.studentId,
            studentName: attendance.studentName,
            date: attendance.date || new Date().toISOString().split('T')[0],
            status: attendance.status,
            remarks: attendance.remarks,
            classId: attendance.classId,
            className: attendance.className,
            teacherName: `${user.firstName} ${user.lastName}`
          };

          await activityNotificationService.notifyAttendanceUpdate(attendanceData);
        }
      } else {
        // Single attendance update
        const attendanceData = {
          studentId: req.body.studentId,
          studentName: req.body.studentName,
          date: req.body.date || new Date().toISOString().split('T')[0],
          status: req.body.status,
          remarks: req.body.remarks,
          classId: req.body.classId,
          className: req.body.className,
          teacherName: `${user.firstName} ${user.lastName}`
        };

        await activityNotificationService.notifyAttendanceUpdate(attendanceData);
      }
    }

    // PAYMENT
    else if (baseUrl.includes('/payments') && method === 'POST') {
      const paymentData = {
        studentId: req.body.studentId,
        studentName: req.body.studentName,
        amount: req.body.amount,
        paymentMethod: req.body.paymentMethod,
        receiptNumber: responseData?.receiptNumber || req.body.receiptNumber,
        collectedBy: user.id,
        paymentFor: req.body.paymentFor || 'School Fees',
        schoolId: user.schoolId
      };

      await activityNotificationService.notifyPayment(paymentData);
    }

  } catch (error) {
    console.error('Error in trackActivity:', error);
  }
}

module.exports = activityTracker;