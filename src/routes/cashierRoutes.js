// cashierRoutes.js
const express = require('express');
const router = express.Router();
const cashierController = require('../controllers/cashierController');

// Pending approval payments page
router.get('/pending-approve', cashierController.getPendingPayments);

// View single payment details
router.get('/payment/:id', cashierController.getPaymentDetails);

// Approve payment route (matches your form action)
router.post('/approve-payment/:id', cashierController.approveParentPayment);

// Alternative approve route (from payment details page)
router.post('/payment/:id/process', cashierController.approveParentPayment);

// Reject payment route
router.post('/payment/:id/reject', cashierController.rejectParentPayment);

// Add to cashier controller
router.get('/pending-payments', ensureAuthenticated, ensureCashier, async (req, res) => {
    try {
        const { paymentType } = req.query;
        
        let whereClause = {
            status: 'pending'
        };
        
        if (paymentType && paymentType !== 'all') {
            whereClause.paymentType = paymentType;
        }
        
        const pendingPayments = await prisma.parentPayment.findMany({
            where: whereClause,
            include: {
                parent: { include: { user: true } },
                student: { include: { user: true } }
            },
            orderBy: { createdAt: 'asc' }
        });
        
        res.render('cashier/pending-payments', {
            title: 'Pending Payments',
            pendingPayments,
            selectedType: paymentType || 'all'
        });
    } catch (error) {
        console.error('Error fetching pending payments:', error);
        res.status(500).render('error/500');
    }
});

module.exports = router;