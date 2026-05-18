const express = require('express');
const router = express.Router();
const accountantController = require('../controllers/accountantController');
const prisma = require('../config/database');
const { 
    isAuthenticated, 
    restrictToSchool, 
    setSchoolContext 
} = require('../middleware/auth');

// Define isAccountant locally since it might not be in auth middleware
const isAccountant = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'accountant') {
        return next();
    }
    req.session.error_msg = 'Access denied: Accountant role required';
    res.redirect('/');
};

// Apply middleware
router.use(isAuthenticated, isAccountant, setSchoolContext, restrictToSchool);

// Dashboard
router.get('/dashboard', accountantController.dashboard);

// Transactions
router.get('/transactions', accountantController.viewTransactions);
router.post('/transactions/create', accountantController.createTransaction);

// Reports
router.get('/reports', accountantController.viewReports);

// Payment Approval
router.get('/approve-payments', accountantController.approvePayments);
router.post('/approve-payment/:paymentId', accountantController.approvePayment);

// Audit Trail
router.get('/audit', accountantController.auditTrail);

// API endpoints for reports
router.get('/api/monthly-data', async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        let whereClause = {};
        if (userSchool && !isSuperAdmin) {
            whereClause.school = userSchool;
        }
        
        const months = [];
        const incomeData = [];
        const expenseData = [];
        
        for (let i = 5; i >= 0; i--) {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
            const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
            
            months.push(date.toLocaleDateString('en-US', { month: 'short' }));
            
            const [monthIncome, monthExpense] = await Promise.all([
                prisma.financialTransaction.aggregate({
                    where: {
                        ...whereClause,
                        type: 'income',
                        date: { gte: monthStart, lte: monthEnd }
                    },
                    _sum: { amount: true }
                }),
                prisma.financialTransaction.aggregate({
                    where: {
                        ...whereClause,
                        type: 'expense',
                        date: { gte: monthStart, lte: monthEnd }
                    },
                    _sum: { amount: true }
                })
            ]);
            
            incomeData.push(monthIncome._sum.amount || 0);
            expenseData.push(monthExpense._sum.amount || 0);
        }
        
        res.json({ success: true, months, incomeData, expenseData });
    } catch (error) {
        console.error('API error:', error);
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

router.get('/api/financial-reports', accountantController.getFinancialReportsData);

router.get('/api/today-activities', accountantController.getTodayActivities);
router.get('/api/audit-log/:logId', accountantController.getAuditLogDetails);
router.get('/api/search-audit', accountantController.searchAuditLogs);

module.exports = router;