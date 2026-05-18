const prisma = require('../config/database');
const { NotificationService } = require('./notificationService');

class ActivityNotificationService {
  constructor() {
    this.notificationService = new NotificationService();
  }

  // Helper: Get students in a class
  async getStudentsInClass(classId) {
    try {
      const classWithStudents = await prisma.class.findUnique({
        where: { id: classId },
        include: {
          students: {
            include: {
              student: {
                include: {
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      email: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!classWithStudents) return [];

      return classWithStudents.students.map(s => ({
        userId: s.student.user.id,
        studentId: s.student.id,
        name: `${s.student.user.firstName} ${s.student.user.lastName}`
      }));
    } catch (error) {
      console.error('Error getting students in class:', error);
      return [];
    }
  }

  // Helper: Get teachers of a class
  async getTeachersOfClass(classId) {
    try {
      const classWithTeachers = await prisma.class.findUnique({
        where: { id: classId },
        include: {
          teachers: {
            include: {
              teacher: {
                include: {
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      email: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!classWithTeachers) return [];

      return classWithTeachers.teachers.map(t => ({
        userId: t.teacher.user.id,
        teacherId: t.teacher.id,
        name: `${t.teacher.user.firstName} ${t.teacher.user.lastName}`
      }));
    } catch (error) {
      console.error('Error getting teachers of class:', error);
      return [];
    }
  }

  // Helper: Get all admins
  async getAllAdmins(schoolId = null) {
    try {
      const where = {
        role: 'admin',
        isActive: true
      };

      if (schoolId) {
        where.admin = { schoolId };
      }

      const admins = await prisma.user.findMany({
        where,
        include: {
          admin: true
        }
      });

      return admins.map(admin => ({
        userId: admin.id,
        adminId: admin.admin?.id,
        name: `${admin.firstName} ${admin.lastName}`,
        roleLevel: admin.admin?.roleLevel || 'admin'
      }));
    } catch (error) {
      console.error('Error getting admins:', error);
      return [];
    }
  }

  // 1. ASSIGNMENT NOTIFICATIONS
  async notifyNewAssignment(assignmentData) {
    try {
      const {
        assignmentId,
        classId,
        title,
        description,
        dueDate,
        teacherId,
        teacherName,
        points,
        assignmentType
      } = assignmentData;

      // Get all students in the class
      const students = await this.getStudentsInClass(classId);
      
      if (students.length === 0) {
        console.log(`No students found in class ${classId} for assignment notification`);
        return { success: true, count: 0 };
      }

      const studentUserIds = students.map(s => s.userId);
      const formattedDueDate = dueDate ? new Date(dueDate).toLocaleDateString() : 'No due date';

      // Create notifications for students
      const result = await this.notificationService.createNotificationsForUsers(studentUserIds, {
        title: '📝 New Assignment',
        message: `New ${assignmentType || 'assignment'}: "${title}" - Due: ${formattedDueDate}`,
        type: 'assignment',
        icon: 'fa-tasks',
        relatedId: assignmentId.toString(),
        metadata: {
          assignmentId,
          classId,
          title,
          description,
          dueDate,
          points,
          assignmentType,
          teacherId,
          teacherName,
          createdAt: new Date().toISOString()
        }
      });

      console.log(`✅ Notified ${result.count || 0} students about assignment: ${title}`);
      
      // Also notify class teachers (excluding the one who created it)
      const teachers = await this.getTeachersOfClass(classId);
      const otherTeacherUserIds = teachers
        .filter(t => t.userId !== teacherId)
        .map(t => t.userId);

      if (otherTeacherUserIds.length > 0) {
        await this.notificationService.createNotificationsForUsers(otherTeacherUserIds, {
          title: '📝 New Assignment Created',
          message: `${teacherName} added a new assignment: "${title}" to class`,
          type: 'assignment',
          icon: 'fa-tasks',
          relatedId: assignmentId.toString(),
          metadata: {
            assignmentId,
            classId,
            title,
            teacherId,
            createdBy: teacherName
          }
        });
        console.log(`✅ Notified ${otherTeacherUserIds.length} co-teachers about assignment`);
      }

      return { success: true, count: result.count };

    } catch (error) {
      console.error('❌ Error in notifyNewAssignment:', error);
      return { success: false, error: error.message };
    }
  }

  // 2. MATERIAL UPLOAD NOTIFICATIONS
  async notifyNewMaterial(materialData) {
    try {
      const {
        materialId,
        classId,
        title,
        description,
        fileType,
        teacherId,
        teacherName,
        subject
      } = materialData;

      // Get all students in the class
      const students = await this.getStudentsInClass(classId);
      
      if (students.length === 0) {
        console.log(`No students found in class ${classId} for material notification`);
        return { success: true, count: 0 };
      }

      const studentUserIds = students.map(s => s.userId);

      // Create notifications for students
      const result = await this.notificationService.createNotificationsForUsers(studentUserIds, {
        title: '📚 New Study Material',
        message: `New ${fileType || 'material'}: "${title}" - ${description || 'Available now'}`,
        type: 'material',
        icon: 'fa-book',
        relatedId: materialId.toString(),
        metadata: {
          materialId,
          classId,
          title,
          description,
          fileType,
          subject,
          teacherId,
          teacherName,
          uploadedAt: new Date().toISOString()
        }
      });

      console.log(`✅ Notified ${result.count || 0} students about material: ${title}`);

      return { success: true, count: result.count };

    } catch (error) {
      console.error('❌ Error in notifyNewMaterial:', error);
      return { success: false, error: error.message };
    }
  }

  // 3. GRADE/SCORE NOTIFICATIONS
  async notifyGradeSubmission(gradeData) {
    try {
      const {
        studentId,
        studentName,
        assignmentId,
        assignmentTitle,
        grade,
        maxGrade,
        percentage,
        teacherId,
        teacherName,
        feedback
      } = gradeData;

      // Get student user
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: { user: true }
      });

      if (!student) {
        console.error(`Student ${studentId} not found for grade notification`);
        return { success: false, error: 'Student not found' };
      }

      // Notify student
      const result = await this.notificationService.createNotification({
        userId: student.user.id,
        title: '🎓 Grade Available',
        message: `Your grade for "${assignmentTitle}": ${grade}/${maxGrade} (${percentage}%)`,
        type: 'grade',
        icon: 'fa-graduation-cap',
        relatedId: assignmentId.toString(),
        metadata: {
          studentId,
          studentName,
          assignmentId,
          assignmentTitle,
          grade,
          maxGrade,
          percentage,
          teacherId,
          teacherName,
          feedback,
          gradedAt: new Date().toISOString()
        }
      });

      console.log(`✅ Notified student ${studentName} about grade for "${assignmentTitle}"`);

      // Also notify class teacher (for their record)
      await this.notificationService.createNotification({
        userId: teacherId,
        title: '📋 Grade Submitted',
        message: `Graded ${studentName}'s assignment "${assignmentTitle}": ${grade}/${maxGrade}`,
        type: 'grade',
        icon: 'fa-check-circle',
        relatedId: assignmentId.toString(),
        metadata: {
          studentId,
          studentName,
          assignmentId,
          assignmentTitle,
          grade,
          maxGrade,
          teacherId
        }
      });

      return { success: true, ...result };

    } catch (error) {
      console.error('❌ Error in notifyGradeSubmission:', error);
      return { success: false, error: error.message };
    }
  }

  // 4. EXAM NOTIFICATIONS
  async notifyNewExam(examData) {
    try {
      const {
        examId,
        classId,
        title,
        description,
        examDate,
        duration,
        teacherId,
        teacherName
      } = examData;

      // Get all students in the class
      const students = await this.getStudentsInClass(classId);
      
      if (students.length === 0) {
        console.log(`No students found in class ${classId} for exam notification`);
        return { success: true, count: 0 };
      }

      const studentUserIds = students.map(s => s.userId);
      const formattedDate = examDate ? new Date(examDate).toLocaleString() : 'Date not set';

      // Create notifications for students
      const result = await this.notificationService.createNotificationsForUsers(studentUserIds, {
        title: '📝 Upcoming Exam',
        message: `Exam: "${title}" - Date: ${formattedDate} (Duration: ${duration || 'N/A'})`,
        type: 'exam',
        icon: 'fa-file-alt',
        relatedId: examId.toString(),
        metadata: {
          examId,
          classId,
          title,
          description,
          examDate,
          duration,
          teacherId,
          teacherName,
          notifiedAt: new Date().toISOString()
        }
      });

      console.log(`✅ Notified ${result.count || 0} students about exam: ${title}`);

      return { success: true, count: result.count };

    } catch (error) {
      console.error('❌ Error in notifyNewExam:', error);
      return { success: false, error: error.message };
    }
  }

  // 5. ANNOUNCEMENT NOTIFICATIONS
  async notifyAnnouncement(announcementData) {
    try {
      const {
        announcementId,
        title,
        content,
        targetAudience, // 'all', 'students', 'teachers', 'parents', 'specific_class'
        classId,
        schoolId,
        createdBy,
        createdById
      } = announcementData;

      let userIds = [];

      if (targetAudience === 'all') {
        // Get all active users in the school
        const users = await prisma.user.findMany({
          where: {
            isActive: true,
            ...(schoolId && { schoolId })
          },
          select: { id: true }
        });
        userIds = users.map(u => u.id);
      }
      else if (targetAudience === 'students') {
        const students = await prisma.student.findMany({
          where: {
            ...(schoolId && { schoolId })
          },
          include: { user: true }
        });
        userIds = students.map(s => s.user.id);
      }
      else if (targetAudience === 'teachers') {
        const teachers = await prisma.teacher.findMany({
          where: {
            ...(schoolId && { schoolId })
          },
          include: { user: true }
        });
        userIds = teachers.map(t => t.user.id);
      }
      else if (targetAudience === 'parents') {
        const parents = await prisma.parent.findMany({
          where: {
            ...(schoolId && { schoolId })
          },
          include: { user: true }
        });
        userIds = parents.map(p => p.user.id);
      }
      else if (targetAudience === 'specific_class' && classId) {
        const students = await this.getStudentsInClass(classId);
        userIds = students.map(s => s.userId);
        
        // Also include class teachers
        const teachers = await this.getTeachersOfClass(classId);
        const teacherUserIds = teachers.map(t => t.userId);
        userIds = [...userIds, ...teacherUserIds];
      }

      // Remove duplicates
      userIds = [...new Set(userIds)];

      if (userIds.length === 0) {
        console.log('No users found for announcement notification');
        return { success: true, count: 0 };
      }

      // Create notifications
      const result = await this.notificationService.createNotificationsForUsers(userIds, {
        title: '📢 Announcement',
        message: `${title}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`,
        type: 'announcement',
        icon: 'fa-bullhorn',
        relatedId: announcementId.toString(),
        metadata: {
          announcementId,
          title,
          content,
          targetAudience,
          classId,
          createdBy,
          createdById,
          createdAt: new Date().toISOString()
        }
      });

      console.log(`✅ Sent announcement "${title}" to ${result.count || 0} users`);

      return { success: true, count: result.count };

    } catch (error) {
      console.error('❌ Error in notifyAnnouncement:', error);
      return { success: false, error: error.message };
    }
  }

  // 6. ATTENDANCE NOTIFICATIONS (to parents)
  async notifyAttendanceUpdate(attendanceData) {
    try {
      const {
        studentId,
        studentName,
        date,
        status,
        remarks,
        classId,
        className,
        teacherName
      } = attendanceData;

      // Get student's parents
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: {
          user: true,
          parents: {
            include: {
              parent: {
                include: { user: true }
              }
            }
          }
        }
      });

      if (!student) {
        console.error(`Student ${studentId} not found for attendance notification`);
        return { success: false, error: 'Student not found' };
      }

      if (student.parents.length === 0) {
        console.log(`Student ${studentName} has no parents to notify`);
        return { success: true, count: 0 };
      }

      const parentUserIds = student.parents.map(p => p.parent.user.id);
      const statusEmoji = {
        present: '✅',
        absent: '❌',
        late: '⚠️',
        excused: '📝'
      }[status] || '📋';

      // Create notifications for parents
      const result = await this.notificationService.createNotificationsForUsers(parentUserIds, {
        title: `${statusEmoji} Attendance Update`,
        message: `${studentName}'s attendance on ${date}: ${status.toUpperCase()}${remarks ? ` - ${remarks}` : ''}`,
        type: 'attendance',
        icon: 'fa-calendar-check',
        relatedId: studentId.toString(),
        metadata: {
          studentId,
          studentName,
          date,
          status,
          remarks,
          classId,
          className,
          teacherName,
          updatedAt: new Date().toISOString()
        }
      });

      console.log(`✅ Notified ${result.count || 0} parents about ${studentName}'s attendance`);

      return { success: true, count: result.count };

    } catch (error) {
      console.error('❌ Error in notifyAttendanceUpdate:', error);
      return { success: false, error: error.message };
    }
  }

  // 7. PAYMENT NOTIFICATIONS (enhanced)
  async notifyPayment(paymentData) {
    try {
      const {
        studentId,
        studentName,
        amount,
        paymentMethod,
        receiptNumber,
        collectedBy,
        paymentFor,
        schoolId
      } = paymentData;

      // Notify admins (cashier, accountant, principal)
      const admins = await this.getAllAdmins(schoolId);
      const adminUserIds = admins.map(a => a.userId);

      if (adminUserIds.length > 0) {
        await this.notificationService.createNotificationsForUsers(adminUserIds, {
          title: '💰 Payment Received',
          message: `Payment of ₦${amount} from ${studentName} for ${paymentFor || 'fees'} (Receipt: ${receiptNumber})`,
          type: 'payment',
          icon: 'fa-money-bill-wave',
          relatedId: receiptNumber,
          metadata: {
            studentId,
            studentName,
            amount,
            paymentMethod,
            receiptNumber,
            collectedBy,
            paymentFor,
            timestamp: new Date().toISOString()
          }
        });
        console.log(`✅ Notified ${adminUserIds.length} admins about payment from ${studentName}`);
      }

      return { success: true, count: adminUserIds.length };

    } catch (error) {
      console.error('❌ Error in notifyPayment:', error);
      return { success: false, error: error.message };
    }
  }

  // 8. SYSTEM-WIDE NOTIFICATIONS
  async systemBroadcast(messageData) {
    try {
      const {
        title,
        message,
        priority = 'normal', // 'low', 'normal', 'high', 'urgent'
        targetRoles = [], // Array of roles: ['student', 'teacher', 'parent', 'admin']
        schoolId = null
      } = messageData;

      let userIds = [];

      if (targetRoles.length === 0) {
        // Send to all active users
        const users = await prisma.user.findMany({
          where: {
            isActive: true,
            ...(schoolId && { schoolId })
          },
          select: { id: true }
        });
        userIds = users.map(u => u.id);
      } else {
        // Send to specific roles
        const users = await prisma.user.findMany({
          where: {
            role: { in: targetRoles },
            isActive: true,
            ...(schoolId && { schoolId })
          },
          select: { id: true }
        });
        userIds = users.map(u => u.id);
      }

      if (userIds.length === 0) {
        console.log('No users found for system broadcast');
        return { success: true, count: 0 };
      }

      const icon = {
        low: 'fa-info-circle',
        normal: 'fa-bell',
        high: 'fa-exclamation-triangle',
        urgent: 'fa-exclamation-circle'
      }[priority] || 'fa-bell';

      const result = await this.notificationService.createNotificationsForUsers(userIds, {
        title: `🔔 ${title}`,
        message: message,
        type: 'system',
        icon: icon,
        metadata: {
          priority,
          targetRoles,
          broadcastAt: new Date().toISOString()
        }
      });

      console.log(`📢 System broadcast sent to ${result.count || 0} users`);

      return { success: true, count: result.count };

    } catch (error) {
      console.error('❌ Error in systemBroadcast:', error);
      return { success: false, error: error.message };
    }
  }

  // 9. BULK NOTIFICATION FOR MULTIPLE ACTIVITIES
  async bulkNotify(activities) {
    try {
      const results = [];
      
      for (const activity of activities) {
        let result;
        
        switch (activity.type) {
          case 'assignment':
            result = await this.notifyNewAssignment(activity.data);
            break;
          case 'material':
            result = await this.notifyNewMaterial(activity.data);
            break;
          case 'grade':
            result = await this.notifyGradeSubmission(activity.data);
            break;
          case 'exam':
            result = await this.notifyNewExam(activity.data);
            break;
          case 'announcement':
            result = await this.notifyAnnouncement(activity.data);
            break;
          case 'attendance':
            result = await this.notifyAttendanceUpdate(activity.data);
            break;
          case 'payment':
            result = await this.notifyPayment(activity.data);
            break;
          default:
            console.warn(`Unknown activity type: ${activity.type}`);
        }
        
        if (result) results.push(result);
      }
      
      return {
        success: true,
        results,
        totalActivities: activities.length,
        successful: results.filter(r => r.success).length
      };
      
    } catch (error) {
      console.error('❌ Error in bulkNotify:', error);
      return { success: false, error: error.message };
    }
  }

  // 10. CLEANUP OLD NOTIFICATIONS
  async cleanupOldNotifications(days = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await prisma.notification.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate
          }
        }
      });

      console.log(`🧹 Cleaned up ${result.count} notifications older than ${days} days`);
      
      return {
        success: true,
        count: result.count,
        message: `Cleaned up ${result.count} old notifications`
      };
      
    } catch (error) {
      console.error('❌ Error cleaning up old notifications:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new ActivityNotificationService();