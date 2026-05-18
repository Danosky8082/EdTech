const { 
  createAssignmentNotification,
  createMaterialNotification 
} = require('../services/notificationService');

// Middleware to send notifications after assignment creation
exports.notifyAfterAssignmentCreate = async (req, res, next) => {
  try {
    // Call next first to create the assignment
    await next();
    
    // If assignment was created successfully (check res.locals or response)
    if (res.locals.assignment && res.locals.assignment.id) {
      await createAssignmentNotification({
        assignmentId: res.locals.assignment.id,
        classId: res.locals.assignment.classId,
        title: res.locals.assignment.title,
        dueDate: res.locals.assignment.dueDate,
        teacherId: req.session.user.id,
        teacherName: `${req.session.user.firstName} ${req.session.user.lastName}`
      });
    }
  } catch (error) {
    console.error('Error in notification middleware:', error);
    // Don't fail the request if notification fails
  }
};

// Middleware to send notifications after material upload
exports.notifyAfterMaterialUpload = async (req, res, next) => {
  try {
    await next();
    
    if (res.locals.material && res.locals.material.id) {
      await createMaterialNotification({
        materialId: res.locals.material.id,
        classId: res.locals.material.classId,
        title: res.locals.material.title,
        description: res.locals.material.description,
        teacherId: req.session.user.id,
        teacherName: `${req.session.user.firstName} ${req.session.user.lastName}`,
        materialType: res.locals.material.type
      });
    }
  } catch (error) {
    console.error('Error in notification middleware:', error);
  }
};