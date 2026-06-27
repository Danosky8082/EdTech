// src/routes/notification.routes.js
const express = require('express');
const router = express.Router();
const { notificationService } = require('../services/notificationService');
const { isAuthenticated } = require('../middleware/auth');

// Get user notifications with filters
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { limit = 20, page = 1, unreadOnly, type, days = 30 } = req.query;

    const result = await notificationService.getUserNotifications(userId, {
      limit: parseInt(limit),
      page: parseInt(page),
      unreadOnly: unreadOnly === 'true',
      type: type || null,
      days: parseInt(days)
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
  }
});

// Mark single notification as read
router.post('/mark-as-read', isAuthenticated, async (req, res) => {
  try {
    const { notificationId } = req.body;
    const userId = req.session.user.id;

    if (!notificationId) {
      return res.status(400).json({ success: false, error: 'Notification ID is required' });
    }

    const result = await notificationService.markNotificationAsRead(notificationId, userId);
    if (!result.success) return res.status(404).json(result);
    res.json(result);
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Mark all notifications as read
router.post('/mark-all-read', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const result = await notificationService.markAllNotificationsAsRead(userId);
    if (!result.success) return res.status(500).json(result);
    res.json(result);
  } catch (error) {
    console.error('❌ Error marking all notifications as read:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Delete notification
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.session.user.id;
    const result = await notificationService.deleteNotification(notificationId, userId);
    if (!result.success) return res.status(404).json(result);
    res.json(result);
  } catch (error) {
    console.error('❌ Error deleting notification:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Get unread count
router.get('/unread-count', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { pagination } = await notificationService.getUserNotifications(userId, {
      limit: 1,
      unreadOnly: true
    });
    res.json({ success: true, count: pagination.unreadCount || 0 });
  } catch (error) {
    console.error('❌ Error getting unread count:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;