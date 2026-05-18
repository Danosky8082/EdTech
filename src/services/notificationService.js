// services/notificationService.js
const prisma = require('../config/database');

const getIconByType = (type) => {
  const icons = {
    payment: 'fa-money-bill-wave',
    wallet: 'fa-wallet',
    assignment: 'fa-tasks',
    grade: 'fa-graduation-cap',
    material: 'fa-book',
    exam: 'fa-file-alt',
    announcement: 'fa-bullhorn',
    system: 'fa-cog',
    warning: 'fa-exclamation-triangle',
    success: 'fa-check-circle',
    info: 'fa-info-circle'
  };
  return icons[type] || 'fa-bell';
};

class NotificationService {
  async getUserNotifications(userId, options = {}) {
    try {
      const { limit = 20, page = 1, unreadOnly = false, type = null, days = 30 } = options;
      const skip = (page - 1) * limit;
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - days);

      const where = {
        userId,                      // ← no parseInt
        createdAt: { gte: daysAgo }
      };
      if (unreadOnly) where.read = false;
      if (type) where.type = type;

      const notifications = await prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      });

      const total = await prisma.notification.count({ where });
      const unreadCount = await prisma.notification.count({
        where: { userId, read: false, createdAt: { gte: daysAgo } }
      });

      const formattedNotifications = notifications.map(n => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        icon: n.icon || getIconByType(n.type),
        relatedId: n.relatedId,
        read: n.read,
        createdAt: n.createdAt,
        metadata: n.metadata
      }));

      return {
        success: true,
        notifications: formattedNotifications,
        pagination: { page, limit, total, pages: Math.ceil(total / limit), unreadCount }
      };
    } catch (error) {
      console.error('Error getting user notifications:', error);
      throw error;
    }
  }

  async markNotificationAsRead(notificationId, userId) {
    try {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId }   // ← no parseInt
      });
      if (!notification) {
        return { success: false, error: 'Notification not found or access denied' };
      }
      await prisma.notification.update({
        where: { id: notificationId },
        data: { read: true, readAt: new Date() }
      });
      return { success: true, message: 'Notification marked as read' };
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return { success: false, error: 'Server error' };
    }
  }

  async markAllNotificationsAsRead(userId) {
    try {
      await prisma.notification.updateMany({
        where: { userId, read: false },          // ← no parseInt
        data: { read: true, readAt: new Date() }
      });
      return { success: true, message: 'All notifications marked as read' };
    } catch (error) {
      console.error('Error marking all as read:', error);
      return { success: false, error: 'Server error' };
    }
  }

  async deleteNotification(notificationId, userId) {
    try {
      const notification = await prisma.notification.findFirst({
        where: { id: notificationId, userId }    // ← no parseInt
      });
      if (!notification) {
        return { success: false, error: 'Notification not found or access denied' };
      }
      await prisma.notification.delete({ where: { id: notificationId } });
      return { success: true, message: 'Notification deleted' };
    } catch (error) {
      console.error('Error deleting notification:', error);
      return { success: false, error: 'Server error' };
    }
  }

  async createNotification(data) {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId: data.userId,                  // ← no parseInt
          title: data.title,
          message: data.message,
          icon: data.icon || getIconByType(data.type || 'info'),
          type: data.type || 'info',
          relatedId: data.relatedId || null,
          expiresAt: data.expiresAt || null,
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

  async createNotificationsForUsers(userIds, notificationData) {
    try {
      const notifications = userIds.map(userId => ({
        userId,                                 // ← no parseInt
        title: notificationData.title,
        message: notificationData.message,
        icon: notificationData.icon || getIconByType(notificationData.type || 'info'),
        type: notificationData.type || 'info',
        relatedId: notificationData.relatedId || null,
        expiresAt: notificationData.expiresAt || null,
        metadata: notificationData.metadata || {},
        read: false,
        createdAt: new Date()
      }));
      await prisma.notification.createMany({ data: notifications });
      return { success: true, count: notifications.length };
    } catch (error) {
      console.error('Error creating notifications for users:', error);
      return { success: false, error: 'Failed to create notifications' };
    }
  }
}

// ─── LEGACY FUNCTIONS (Keep for compatibility) ──────────────────
const notificationService = new NotificationService();

const createPaymentNotification = async (paymentData) => { /* … same as before, remove parseInt */ };
const createWalletDepositNotification = async (depositData) => { /* remove parseInt */ };
const createAssignmentNotification = async (assignmentData) => { /* remove parseInt */ };
const createMaterialNotification = async (materialData) => { /* remove parseInt */ };
const createGradeNotification = async (gradeData) => { /* remove parseInt */ };
const createExamNotification = async (examData) => { /* remove parseInt */ };
const createAnnouncementNotification = async (announcementData) => { /* remove parseInt */ };
const getUnreadNotifications = async (userId) => { /* … */ };
const getAllNotifications = async (userId, limit = 20, page = 1) => { /* … */ };
const markAsRead = async (notificationId, userId) => { /* … */ };
const markAllAsRead = async (userId) => { /* … */ };
const deleteNotification = async (notificationId, userId) => { /* … */ };

module.exports = {
  NotificationService,
  notificationService,
  createPaymentNotification,
  createWalletDepositNotification,
  createAssignmentNotification,
  createMaterialNotification,
  createGradeNotification,
  createExamNotification,
  createAnnouncementNotification,
  getUnreadNotifications,
  getAllNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getIconByType
};