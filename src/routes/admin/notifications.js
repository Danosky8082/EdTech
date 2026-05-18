const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../../middleware/auth');
const prisma = require('../../config/database');
const activityNotificationService = require('../../services/activityNotificationService');

// Get notification statistics
router.get('/notification-stats', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const schoolId = req.session.user.schoolId;
    
    // Total notifications
    const total = await prisma.notification.count({
      where: { user: { schoolId } }
    });
    
    // Unread notifications
    const unread = await prisma.notification.count({
      where: { 
        read: false,
        user: { schoolId }
      }
    });
    
    // Today's notifications
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayCount = await prisma.notification.count({
      where: {
        createdAt: { gte: today },
        user: { schoolId }
      }
    });
    
    // Active users (users with activity in last 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const activeUsers = await prisma.user.count({
      where: {
        schoolId,
        isActive: true,
        lastActive: { gte: yesterday }
      }
    });
    
    // Notifications by type
    const byType = await prisma.notification.groupBy({
      by: ['type'],
      where: { user: { schoolId } },
      _count: true
    });
    
    // Daily notifications for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const dailyStats = await prisma.$queryRaw`
      SELECT DATE(createdAt) as date, COUNT(*) as count
      FROM Notification n
      JOIN User u ON n.userId = u.id
      WHERE u.schoolId = ${schoolId} 
        AND n.createdAt >= ${sevenDaysAgo}
      GROUP BY DATE(n.createdAt)
      ORDER BY date DESC
    `;
    
    res.json({
      success: true,
      stats: {
        total,
        unread,
        today: todayCount,
        activeUsers,
        byType: byType.reduce((acc, item) => {
          acc[item.type] = item._count;
          return acc;
        }, {}),
        daily: dailyStats.reduce((acc, item) => {
          acc[item.date.toISOString().split('T')[0]] = parseInt(item.count);
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Error getting notification stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send manual notification
router.post('/send-notification', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { 
      recipientType, 
      type, 
      title, 
      message, 
      priority,
      classId,
      userId 
    } = req.body;
    
    const schoolId = req.session.user.schoolId;
    
    let result;
    
    if (recipientType === 'class' && classId) {
      // Get students in class
      const classWithStudents = await prisma.class.findUnique({
        where: { id: parseInt(classId) },
        include: {
          students: {
            include: {
              student: {
                include: { user: true }
              }
            }
          }
        }
      });
      
      if (!classWithStudents) {
        return res.status(404).json({ success: false, error: 'Class not found' });
      }
      
      const studentUserIds = classWithStudents.students.map(s => s.student.user.id);
      
      result = await activityNotificationService.systemBroadcast({
        title,
        message,
        priority,
        targetRoles: [],
        schoolId
      });
    }
    else if (recipientType === 'user' && userId) {
      result = await activityNotificationService.systemBroadcast({
        title,
        message,
        priority,
        targetRoles: [],
        schoolId
      });
    }
    else {
      // Send to all users of specific type
      const targetRoles = recipientType === 'all' ? [] : [recipientType];
      
      result = await activityNotificationService.systemBroadcast({
        title,
        message,
        priority,
        targetRoles,
        schoolId
      });
    }
    
    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId: req.session.user.id,
        action: 'send_notification',
        details: `Sent notification to ${recipientType}: ${title}`,
        status: result.success ? 'success' : 'error',
        metadata: {
          recipientType,
          type,
          title,
          count: result.count || 0
        }
      }
    });
    
    res.json(result);
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get notification logs
router.get('/notification-logs', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const logs = await prisma.activityLog.findMany({
      where: {
        OR: [
          { action: 'send_notification' },
          { action: { contains: 'notification' } }
        ]
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit),
      skip: parseInt(offset)
    });
    
    const formattedLogs = logs.map(log => ({
      id: log.id,
      action: log.action.replace('_', ' ').toUpperCase(),
      details: log.details,
      status: log.status,
      user: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System',
      timestamp: log.createdAt,
      metadata: log.metadata
    }));
    
    res.json({
      success: true,
      logs: formattedLogs,
      total: await prisma.activityLog.count({
        where: {
          OR: [
            { action: 'send_notification' },
            { action: { contains: 'notification' } }
          ]
        }
      })
    });
  } catch (error) {
    console.error('Error getting notification logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk send notifications
router.post('/bulk-send', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { notifications } = req.body;
    
    if (!Array.isArray(notifications) || notifications.length === 0) {
      return res.status(400).json({ success: false, error: 'Notifications array is required' });
    }
    
    const result = await activityNotificationService.bulkNotify(notifications);
    
    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId: req.session.user.id,
        action: 'bulk_send_notifications',
        details: `Sent ${notifications.length} notifications in bulk`,
        status: result.success ? 'success' : 'error',
        metadata: {
          count: notifications.length,
          successful: result.successful || 0
        }
      }
    });
    
    res.json(result);
  } catch (error) {
    console.error('Error in bulk send:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cleanup old notifications
router.post('/cleanup', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { days = 90 } = req.body;
    
    const result = await activityNotificationService.cleanupOldNotifications(days);
    
    // Log the activity
    await prisma.activityLog.create({
      data: {
        userId: req.session.user.id,
        action: 'cleanup_notifications',
        details: `Cleaned up notifications older than ${days} days`,
        status: result.success ? 'success' : 'error',
        metadata: {
          days,
          count: result.count || 0
        }
      }
    });
    
    res.json(result);
  } catch (error) {
    console.error('Error in cleanup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;