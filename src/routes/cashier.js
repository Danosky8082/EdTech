const express = require('express');
const router = express.Router();
const cashierController = require('../controllers/cashierController');
const prisma = require('../config/database');
const { 
    isAuthenticated, 
    restrictToSchool, 
    setSchoolContext 
} = require('../middleware/auth');

// Define isCashier locally
const isCashier = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'cashier') {
        return next();
    }
    req.session.error_msg = 'Access denied: Cashier role required';
    res.redirect('/');
};

// Apply middleware
router.use(isAuthenticated, isCashier, setSchoolContext, restrictToSchool);

// Dashboard
router.get('/dashboard', cashierController.dashboard);

// Fee Payments
router.post('/fee-payment', cashierController.recordFeePayment);
router.post('/other-transaction', cashierController.recordOtherTransaction);

// Student Search
router.get('/students', cashierController.getStudentsForPayment);

// Transactions
router.get('/transactions', cashierController.getDailyTransactions);

// Parent Payments
router.get('/pending-payments', cashierController.viewPendingPayments);
router.post('/approve-payment/:paymentId', cashierController.approveParentPayment);

// API endpoints
router.get('/api/dashboard-data', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        
        // Today's date
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        let whereClause = { school: userSchool };
        
        const [
            todaySummary,
            pendingPayments,
            recentTransactions
        ] = await Promise.all([
            // Today's summary
            prisma.dailyTransaction.aggregate({
                where: {
                    ...whereClause,
                    createdAt: {
                        gte: today,
                        lt: tomorrow
                    }
                },
                _sum: { amount: true },
                _count: { id: true }
            }),
            
            // Pending payments count
            prisma.parentPayment.count({
                where: {
                    status: 'pending',
                    ...whereClause
                }
            }),
            
            // Recent transactions
            prisma.dailyTransaction.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                take: 5
            })
        ]);
        
        // Notifications
        const notificationCount = await prisma.notification.count({
            where: {
                userId: userId,
                read: false,
                OR: [
                    { expiresAt: { gt: new Date() } },
                    { expiresAt: null }
                ]
            }
        });
        
        res.json({
            success: true,
            today: {
                total: todaySummary._sum.amount || 0,
                transactionCount: todaySummary._count.id
            },
            pendingPayments,
            recentTransactions: recentTransactions.length,
            notificationCount
        });
        
    } catch (error) {
        console.error('Dashboard data error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Notification endpoints
router.post('/notifications/mark-as-read', async (req, res) => {
    try {
        const { notificationId } = req.body;
        await prisma.notification.update({
            where: { id: notificationId },
            data: { read: true, readAt: new Date() }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Mark notification as read error:', error);
        res.status(500).json({ success: false });
    }
});

router.post('/notifications/mark-all-read', async (req, res) => {
    try {
        await prisma.notification.updateMany({
            where: { userId: req.session.user.id, read: false },
            data: { read: true, readAt: new Date() }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Mark all notifications as read error:', error);
        res.status(500).json({ success: false });
    }
});

// Add these new routes for payment processing
router.get('/payment/:id', cashierController.viewPaymentDetails);
router.post('/payment/:id/process', cashierController.processPayment);
router.post('/payment/:id/reject', cashierController.rejectParentPayment);

router.get('/pending-approve', cashierController.getPendingPayments);

// Make sure you also have the POST route for approving
router.post('/approve-payment/:id', cashierController.approveParentPayment);



module.exports = router;