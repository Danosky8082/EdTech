const prisma = require('../config/database');

// ============================================================
// HELPERS
// ============================================================
const getIconByType = (type) => {
  const icons = {
    payment: 'fa-money-bill-wave',
    wallet: 'fa-wallet',
    assignment: 'fa-tasks',
    grade: 'fa-graduation-cap',
    material: 'fa-book',
    exam: 'fa-file-alt',
    announcement: 'fa-bullhorn',
    attendance: 'fa-calendar-check',
    system: 'fa-cog',
    warning: 'fa-exclamation-triangle',
    success: 'fa-check-circle',
    info: 'fa-info-circle'
  };
  return icons[type] || 'fa-bell';
};

// Helper: Get students in a class
const getStudentsInClass = async (classId) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { classId },
      include: {
        student: { include: { user: { select: { id: true, firstName: true, lastName: true } } } }
      }
    });
    return enrollments.map(e => ({
      userId: e.student.user.id,
      studentId: e.student.id,
      name: `${e.student.user.firstName} ${e.student.user.lastName}`
    }));
  } catch (error) {
    console.error('Error getting students in class:', error);
    return [];
  }
};

// Helper: Get teachers of a class
const getTeachersOfClass = async (classId) => {
  try {
    const classWithTeachers = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teachers: {
          include: {
            teacher: { include: { user: { select: { id: true, firstName: true, lastName: true } } } }
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
};

// Helper: Get all admins in a school
const getAllAdmins = async (school = null) => {
  try {
    const where = {
      role: 'admin',
      isActive: true
    };
    if (school) {
      where.school = school;
    }
    const admins = await prisma.user.findMany({
      where,
      include: { admin: true }
    });
    return admins.map(a => ({
      userId: a.id,
      adminId: a.admin?.id,
      name: `${a.firstName} ${a.lastName}`,
      roleLevel: a.admin?.roleLevel || 'admin'
    }));
  } catch (error) {
    console.error('Error getting admins:', error);
    return [];
  }
};

// Helper: Get users for a specific school/role
const getUsersForSchool = async (school, roles = ['admin', 'cashier', 'accountant']) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        school,
        role: { in: roles },
        isActive: true
      },
      select: { id: true }
    });
    return users.map(u => u.id);
  } catch (error) {
    console.error('Error getting users for school:', error);
    return [];
  }
};

// ============================================================
// CORE NOTIFICATION SERVICE
// ============================================================
class NotificationService {
  // Get user notifications with pagination and filters
  async getUserNotifications(userId, options = {}) {
    try {
      const { limit = 20, page = 1, unreadOnly = false, type = null, days = 30 } = options;
      const skip = (page - 1) * limit;
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - days);

      const where = {
        userId,
        createdAt: { gte: daysAgo },
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null }
        ]
      };
      if (unreadOnly) where.read = false;
      if (type) where.type = type;

      const [notifications, total, unreadCount] = await prisma.$transaction([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: parseInt(limit)
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({
          where: { ...where, read: false }
        })
      ]);

      const formattedNotifications = notifications.map(n => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        icon: n.icon || getIconByType(n.type),
        relatedId: n.relatedId,
        read: n.read,
        createdAt: n.createdAt,
        metadata: n.metadata || {}
      }));

      return {
        success: true,
        notifications: formattedNotifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
          unreadCount
        }
      };
    } catch (error) {
      console.error('Error getting user notifications:', error);
      return { success: false, error: error.message };
    }
  }

  // Mark a single notification as read
  async markNotificationAsRead(notificationId, userId) {
    try {
      const notification = await prisma.notification.findFirst({
        where: { id: parseInt(notificationId), userId }
      });
      if (!notification) {
        return { success: false, error: 'Notification not found or access denied' };
      }
      await prisma.notification.update({
        where: { id: parseInt(notificationId) },
        data: { read: true, readAt: new Date() }
      });
      return { success: true, message: 'Notification marked as read' };
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return { success: false, error: 'Server error' };
    }
  }

  // Mark all notifications as read
  async markAllNotificationsAsRead(userId) {
    try {
      await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true, readAt: new Date() }
      });
      return { success: true, message: 'All notifications marked as read' };
    } catch (error) {
      console.error('Error marking all as read:', error);
      return { success: false, error: 'Server error' };
    }
  }

  // Delete a notification
  async deleteNotification(notificationId, userId) {
    try {
      const notification = await prisma.notification.findFirst({
        where: { id: parseInt(notificationId), userId }
      });
      if (!notification) {
        return { success: false, error: 'Notification not found or access denied' };
      }
      await prisma.notification.delete({ where: { id: parseInt(notificationId) } });
      return { success: true, message: 'Notification deleted' };
    } catch (error) {
      console.error('Error deleting notification:', error);
      return { success: false, error: 'Server error' };
    }
  }

  // Create a single notification
  async createNotification(data) {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId: data.userId,
          title: data.title,
          message: data.message,
          icon: data.icon || getIconByType(data.type || 'info'),
          type: data.type || 'info',
          relatedId: data.relatedId || null,
          expiresAt: data.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          metadata: data.metadata || {},
          read: false
        }
      });
      return { success: true, notification };
    } catch (error) {
      console.error('Error creating notification:', error);
      return { success: false, error: 'Failed to create notification' };
    }
  }

  // Create notifications for multiple users
  async createNotificationsForUsers(userIds, notificationData) {
    try {
      const notifications = userIds.map(userId => ({
        userId,
        title: notificationData.title,
        message: notificationData.message,
        icon: notificationData.icon || getIconByType(notificationData.type || 'info'),
        type: notificationData.type || 'info',
        relatedId: notificationData.relatedId || null,
        expiresAt: notificationData.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        metadata: notificationData.metadata || {},
        read: false,
        createdAt: new Date()
      }));
      const result = await prisma.notification.createMany({ data: notifications });
      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error creating notifications for users:', error);
      return { success: false, error: 'Failed to create notifications' };
    }
  }

  // ============================================================
  // SPECIFIC NOTIFICATION TYPES
  // ============================================================

  // 1. Assignment
  async createAssignmentNotification(data) {
    try {
      const { assignmentId, classId, title, dueDate, teacherId, teacherName, points } = data;
      const students = await getStudentsInClass(classId);
      if (students.length === 0) return { success: true, count: 0 };

      const studentUserIds = students.map(s => s.userId);
      const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString() : 'No due date';

      const result = await this.createNotificationsForUsers(studentUserIds, {
        title: '📝 New Assignment',
        message: `New assignment: "${title}" - Due: ${dueDateStr}`,
        type: 'assignment',
        icon: 'fa-tasks',
        relatedId: assignmentId.toString(),
        metadata: { assignmentId, classId, title, dueDate, teacherId, teacherName, points }
      });

      // Notify co-teachers (excluding creator)
      const teachers = await getTeachersOfClass(classId);
      const otherTeacherIds = teachers.filter(t => t.userId !== teacherId).map(t => t.userId);
      if (otherTeacherIds.length > 0) {
        await this.createNotificationsForUsers(otherTeacherIds, {
          title: '📝 New Assignment Created',
          message: `${teacherName} added assignment "${title}" to class`,
          type: 'assignment',
          icon: 'fa-tasks',
          relatedId: assignmentId.toString(),
          metadata: { assignmentId, classId, title, teacherId }
        });
      }

      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error creating assignment notification:', error);
      return { success: false, error: error.message };
    }
  }

  // 2. Material
  async createMaterialNotification(data) {
    try {
      const { materialId, classId, title, teacherId, teacherName, materialType } = data;
      const students = await getStudentsInClass(classId);
      if (students.length === 0) return { success: true, count: 0 };

      const studentUserIds = students.map(s => s.userId);
      const result = await this.createNotificationsForUsers(studentUserIds, {
        title: '📚 New Study Material',
        message: `New ${materialType || 'material'}: "${title}" - Available now`,
        type: 'material',
        icon: 'fa-book',
        relatedId: materialId.toString(),
        metadata: { materialId, classId, title, teacherId, teacherName, materialType }
      });

      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error creating material notification:', error);
      return { success: false, error: error.message };
    }
  }

  // 3. Grade
  async createGradeNotification(data) {
    try {
      const { studentId, studentName, assignmentId, assignmentTitle, grade, maxGrade, teacherId, teacherName, feedback } = data;
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: { user: { select: { id: true } } }
      });
      if (!student) return { success: false, error: 'Student not found' };

      const percentage = maxGrade > 0 ? Math.round((grade / maxGrade) * 100) : 0;

      await this.createNotification({
        userId: student.user.id,
        title: '🎓 Grade Available',
        message: `Your grade for "${assignmentTitle}": ${grade}/${maxGrade} (${percentage}%)`,
        type: 'grade',
        icon: 'fa-graduation-cap',
        relatedId: assignmentId.toString(),
        metadata: { studentId, assignmentId, grade, maxGrade, percentage, teacherName, feedback }
      });

      // Notify teacher
      await this.createNotification({
        userId: teacherId,
        title: '📋 Grade Submitted',
        message: `Graded ${studentName}'s assignment "${assignmentTitle}": ${grade}/${maxGrade}`,
        type: 'grade',
        icon: 'fa-check-circle',
        relatedId: assignmentId.toString(),
        metadata: { studentId, assignmentId, grade, maxGrade }
      });

      return { success: true };
    } catch (error) {
      console.error('Error creating grade notification:', error);
      return { success: false, error: error.message };
    }
  }

  // 4. Exam
  async createExamNotification(data) {
    try {
      const { examId, classId, title, examDate, duration, teacherId, teacherName } = data;
      const students = await getStudentsInClass(classId);
      if (students.length === 0) return { success: true, count: 0 };

      const studentUserIds = students.map(s => s.userId);
      const dateStr = examDate ? new Date(examDate).toLocaleString() : 'Date not set';
      const result = await this.createNotificationsForUsers(studentUserIds, {
        title: '📝 Upcoming Exam',
        message: `Exam: "${title}" - Date: ${dateStr} (Duration: ${duration || 'N/A'})`,
        type: 'exam',
        icon: 'fa-file-alt',
        relatedId: examId.toString(),
        metadata: { examId, classId, title, examDate, duration, teacherId, teacherName }
      });

      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error creating exam notification:', error);
      return { success: false, error: error.message };
    }
  }

  // 5. Payment
  async createPaymentNotification(data) {
    try {
      const { studentId, studentName, amount, paymentMethod, receiptNumber, collectedBy, paymentFor, school } = data;
      const adminUserIds = await getUsersForSchool(school, ['admin', 'cashier', 'accountant', 'headteacher', 'principal']);
      if (adminUserIds.length === 0) return { success: true, count: 0 };

      const result = await this.createNotificationsForUsers(adminUserIds, {
        title: '💰 Payment Received',
        message: `Payment of ₦${amount} from ${studentName} for ${paymentFor || 'fees'} (Receipt: ${receiptNumber})`,
        type: 'payment',
        icon: 'fa-money-bill-wave',
        relatedId: receiptNumber,
        metadata: { studentId, amount, paymentMethod, receiptNumber, collectedBy, paymentFor }
      });

      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error creating payment notification:', error);
      return { success: false, error: error.message };
    }
  }

  // 6. Wallet Deposit
  async createWalletDepositNotification(data) {
    try {
      const { parentId, amount, paymentMethod, school } = data;
      const parent = await prisma.parent.findUnique({
        where: { id: parentId },
        include: { user: { select: { firstName: true, lastName: true } } }
      });
      if (!parent) return { success: false, error: 'Parent not found' };

      const adminUserIds = await getUsersForSchool(school, ['admin', 'cashier', 'accountant', 'headteacher', 'principal']);
      if (adminUserIds.length === 0) return { success: true, count: 0 };

      const message = `Wallet deposit by ${parent.user.firstName} ${parent.user.lastName} – Amount: ₦${amount} (${paymentMethod})`;
      const result = await this.createNotificationsForUsers(adminUserIds, {
        title: '💰 Wallet Deposit',
        message,
        type: 'wallet',
        icon: 'fa-wallet',
        relatedId: parentId.toString(),
        metadata: { parentId, amount, paymentMethod }
      });

      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error creating wallet deposit notification:', error);
      return { success: false, error: error.message };
    }
  }

  // 7. Announcement
  async createAnnouncementNotification(data) {
    try {
      const { title, content, targetAudience, classId, school, createdBy } = data;
      let userIds = [];

      if (targetAudience === 'all') {
        const users = await prisma.user.findMany({
          where: { isActive: true, ...(school && { school }) },
          select: { id: true }
        });
        userIds = users.map(u => u.id);
      } else if (targetAudience === 'students') {
        const students = await prisma.student.findMany({
          where: { ...(school && { school }) },
          include: { user: { select: { id: true } } }
        });
        userIds = students.map(s => s.user.id);
      } else if (targetAudience === 'teachers') {
        const teachers = await prisma.teacher.findMany({
          where: { ...(school && { school }) },
          include: { user: { select: { id: true } } }
        });
        userIds = teachers.map(t => t.user.id);
      } else if (targetAudience === 'parents') {
        const parents = await prisma.parent.findMany({
          where: { ...(school && { school }) },
          include: { user: { select: { id: true } } }
        });
        userIds = parents.map(p => p.user.id);
      } else if (targetAudience === 'specific_class' && classId) {
        const students = await getStudentsInClass(classId);
        userIds = students.map(s => s.userId);
        const teachers = await getTeachersOfClass(classId);
        userIds = [...userIds, ...teachers.map(t => t.userId)];
      }

      userIds = [...new Set(userIds)];
      if (userIds.length === 0) return { success: true, count: 0 };

      const result = await this.createNotificationsForUsers(userIds, {
        title: '📢 Announcement',
        message: `${title}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`,
        type: 'announcement',
        icon: 'fa-bullhorn',
        metadata: { title, content, targetAudience, classId, createdBy }
      });

      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error creating announcement notification:', error);
      return { success: false, error: error.message };
    }
  }

  // 8. Attendance
  async createAttendanceNotification(data) {
    try {
      const { studentId, studentName, date, status, remarks, classId, className, teacherName } = data;
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: {
          parents: {
            include: { parent: { include: { user: { select: { id: true } } } } }
          }
        }
      });
      if (!student || student.parents.length === 0) return { success: true, count: 0 };

      const parentUserIds = student.parents.map(p => p.parent.user.id);
      const statusEmoji = { present: '✅', absent: '❌', late: '⚠️', excused: '📝' }[status] || '📋';

      const result = await this.createNotificationsForUsers(parentUserIds, {
        title: `${statusEmoji} Attendance Update`,
        message: `${studentName}'s attendance on ${date}: ${status.toUpperCase()}${remarks ? ` - ${remarks}` : ''}`,
        type: 'attendance',
        icon: 'fa-calendar-check',
        relatedId: studentId.toString(),
        metadata: { studentId, date, status, remarks, classId, className, teacherName }
      });

      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error creating attendance notification:', error);
      return { success: false, error: error.message };
    }
  }

  // 9. System Broadcast
  async systemBroadcast(data) {
    try {
      const { title, message, priority = 'normal', targetRoles = [], school } = data;
      let userIds = [];

      if (targetRoles.length === 0) {
        const users = await prisma.user.findMany({
          where: { isActive: true, ...(school && { school }) },
          select: { id: true }
        });
        userIds = users.map(u => u.id);
      } else {
        const users = await prisma.user.findMany({
          where: { role: { in: targetRoles }, isActive: true, ...(school && { school }) },
          select: { id: true }
        });
        userIds = users.map(u => u.id);
      }

      if (userIds.length === 0) return { success: true, count: 0 };

      const iconMap = { low: 'fa-info-circle', normal: 'fa-bell', high: 'fa-exclamation-triangle', urgent: 'fa-exclamation-circle' };
      const result = await this.createNotificationsForUsers(userIds, {
        title: `🔔 ${title}`,
        message,
        type: 'system',
        icon: iconMap[priority] || 'fa-bell',
        metadata: { priority, targetRoles }
      });

      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error in systemBroadcast:', error);
      return { success: false, error: error.message };
    }
  }

  // 10. Bulk notifications
  async bulkNotify(activities) {
    try {
      const results = [];
      for (const activity of activities) {
        let result;
        switch (activity.type) {
          case 'assignment': result = await this.createAssignmentNotification(activity.data); break;
          case 'material': result = await this.createMaterialNotification(activity.data); break;
          case 'grade': result = await this.createGradeNotification(activity.data); break;
          case 'exam': result = await this.createExamNotification(activity.data); break;
          case 'payment': result = await this.createPaymentNotification(activity.data); break;
          case 'wallet': result = await this.createWalletDepositNotification(activity.data); break;
          case 'announcement': result = await this.createAnnouncementNotification(activity.data); break;
          case 'attendance': result = await this.createAttendanceNotification(activity.data); break;
          default: console.warn(`Unknown activity type: ${activity.type}`);
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
      console.error('Error in bulkNotify:', error);
      return { success: false, error: error.message };
    }
  }

  // 11. Cleanup old notifications
  async cleanupOldNotifications(days = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const result = await prisma.notification.deleteMany({
        where: { createdAt: { lt: cutoffDate } }
      });
      return { success: true, count: result.count };
    } catch (error) {
      console.error('Error cleaning up notifications:', error);
      return { success: false, error: error.message };
    }
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================
const notificationService = new NotificationService();

// ============================================================
// EXPORTS – FULL API
// ============================================================
module.exports = {
  // Core methods
  notificationService,
  // Specific notification creators (convenience)
  createAssignmentNotification: (data) => notificationService.createAssignmentNotification(data),
  createMaterialNotification: (data) => notificationService.createMaterialNotification(data),
  createGradeNotification: (data) => notificationService.createGradeNotification(data),
  createExamNotification: (data) => notificationService.createExamNotification(data),
  createPaymentNotification: (data) => notificationService.createPaymentNotification(data),
  createWalletDepositNotification: (data) => notificationService.createWalletDepositNotification(data),
  createAnnouncementNotification: (data) => notificationService.createAnnouncementNotification(data),
  createAttendanceNotification: (data) => notificationService.createAttendanceNotification(data),
  systemBroadcast: (data) => notificationService.systemBroadcast(data),
  bulkNotify: (activities) => notificationService.bulkNotify(activities),
  getUserNotifications: (userId, options) => notificationService.getUserNotifications(userId, options),
  markNotificationAsRead: (notificationId, userId) => notificationService.markNotificationAsRead(notificationId, userId),
  markAllNotificationsAsRead: (userId) => notificationService.markAllNotificationsAsRead(userId),
  deleteNotification: (notificationId, userId) => notificationService.deleteNotification(notificationId, userId),
  cleanupOldNotifications: (days) => notificationService.cleanupOldNotifications(days),
  // Legacy aliases (for compatibility)
  getUnreadNotifications: (userId) => notificationService.getUserNotifications(userId, { unreadOnly: true, limit: 10 }),
  markAsRead: (notificationId, userId) => notificationService.markNotificationAsRead(notificationId, userId),
  markAllAsRead: (userId) => notificationService.markAllNotificationsAsRead(userId),
};