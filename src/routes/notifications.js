const express = require('express');
const router = express.Router();
const { notificationService } = require('../services/notificationService');
const { isAuthenticated } = require('../middleware/auth');

// Get user notifications with filters
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { 
      limit = 20, 
      page = 1, 
      unreadOnly, 
      type,
      days = 30 
    } = req.query;

    const result = await notificationService.getUserNotifications(userId, {
      limit: parseInt(limit),
      page: parseInt(page),
      unreadOnly: unreadOnly === 'true',
      type: type || null,
      days: parseInt(days)
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch notifications' 
    });
  }
});

// Mark single notification as read
router.post('/mark-as-read', isAuthenticated, async (req, res) => {
  try {
    const { notificationId } = req.body;
    const userId = req.session.user.id;

    if (!notificationId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Notification ID is required' 
      });
    }

    const result = await notificationService.markNotificationAsRead(notificationId, userId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Mark all notifications as read
router.post('/mark-all-read', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const result = await notificationService.markAllNotificationsAsRead(userId);

    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error marking all notifications as read:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Delete notification
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.session.user.id;

    const result = await notificationService.deleteNotification(notificationId, userId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error deleting notification:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
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

    res.json({
      success: true,
      count: pagination.unreadCount || 0
    });
  } catch (error) {
    console.error('❌ Error getting unread count:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Create test notification (for debugging)
router.post('/test', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { title, message, type } = req.body;

    const success = await notificationService.createNotification({
      userId,
      title: title || 'Test Notification',
      message: message || 'This is a test notification',
      type: type || 'info',
      metadata: { test: true }
    });

    res.json({
      success,
      message: 'Test notification created'
    });
  } catch (error) {
    console.error('❌ Error creating test notification:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

const {
  notifyStudentsAboutAssignment,
  notifyStudentsAboutMaterial,
  notifyStudentAboutGrade,
  notifyStudentsAboutExam,
  notifyUsersAboutAnnouncement
} = require('../controllers/notificationTriggers');

// Trigger assignment notification (typically called from assignment controller)
router.post('/trigger/assignment', isAuthenticated, notifyStudentsAboutAssignment);

// Trigger material notification (typically called from material controller)
router.post('/trigger/material', isAuthenticated, notifyStudentsAboutMaterial);

// Trigger grade notification
router.post('/trigger/grade', isAuthenticated, notifyStudentAboutGrade);

// Trigger exam notification
router.post('/trigger/exam', isAuthenticated, notifyStudentsAboutExam);

// Trigger announcement notification
router.post('/trigger/announcement', isAuthenticated, notifyUsersAboutAnnouncement);

// Add SSE (Server-Sent Events) for real-time notifications
router.get('/stream', isAuthenticated, (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const userId = req.session.user.id;
  
  // Send a ping every 30 seconds to keep connection alive
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 30000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    // Remove from active connections
    const index = activeConnections.findIndex(conn => conn.userId === userId);
    if (index !== -1) {
      activeConnections.splice(index, 1);
    }
  });

  // Store connection
  activeConnections.push({ userId, res });
});

// Helper to send notifications to specific users
function sendNotificationToUser(userId, notification) {
  const connection = activeConnections.find(conn => conn.userId === userId);
  if (connection) {
    connection.res.write(`data: ${JSON.stringify({
      type: 'new_notification',
      notification
    })}\n\n`);
  }
}

// Store active connections
const activeConnections = [];

module.exports = router;