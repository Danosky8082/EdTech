const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');

// Mark all notifications as read
router.post('/mark-all-read', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    await prisma.notification.updateMany({
      where: {
        userId: userId,
        read: false
      },
      data: {
        read: true,
        readAt: new Date()
      }
    });

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Mark single notification as read
router.post('/mark-as-read', isAuthenticated, async (req, res) => {
  try {
    const { notificationId } = req.body;
    const userId = req.session.user.id;
    
    await prisma.notification.update({
      where: {
        id: parseInt(notificationId),
        userId: userId
      },
      data: {
        read: true,
        readAt: new Date()
      }
    });

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Get notifications (API endpoint)
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.session.user.id,
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null }
        ]
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 20
    });

    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;