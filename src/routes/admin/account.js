const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../../middleware/auth');
const prisma = require('../../config/database');

// Apply authentication middleware
router.use(requireAuth);
router.use(requireRole('admin'));

// View all transactions (admin view)
router.get('/transactions', async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        let whereClause = {};
        if (userSchool && !isSuperAdmin) {
            whereClause.school = userSchool;
        }
        
        const [parentPayments, dailyTransactions, financialTransactions] = await Promise.all([
            // Parent payments
            prisma.parentPayment.findMany({
                where: whereClause,
                include: {
                    parent: {
                        include: {
                            user: {
                                select: {
                                    firstName: true,
                                    lastName: true
                                }
                            }
                        }
                    },
                    student: {
                        include: {
                            user: {
                                select: {
                                    firstName: true,
                                    lastName: true
                                }
                            }
                        }
                    },
                    cashier: {
                        select: {
                            firstName: true,
                            lastName: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 50
            }),
            
            // Daily transactions
            prisma.dailyTransaction.findMany({
                where: whereClause,
                include: {
                    collector: {
                        select: {
                            firstName: true,
                            lastName: true
                        }
                    },
                    student: {
                        include: {
                            user: {
                                select: {
                                    firstName: true,
                                    lastName: true
                                }
                            }
                        }
                    },
                    parent: {
                        include: {
                            user: {
                                select: {
                                    firstName: true,
                                    lastName: true
                                }
                            }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 50
            }),
            
            // Financial transactions
            prisma.financialTransaction.findMany({
                where: whereClause,
                include: {
                    creator: {
                        select: {
                            firstName: true,
                            lastName: true
                        }
                    }
                },
                orderBy: { date: 'desc' },
                take: 50
            })
        ]);
        
        res.render('admin/account/transactions', {
            title: 'All Transactions',
            parentPayments,
            dailyTransactions,
            financialTransactions,
            userSchool,
            isSuperAdmin
        });
        
    } catch (error) {
        console.error('Error loading transactions:', error);
        res.status(500).render('error/500', { title: 'Server Error' });
    }
});

module.exports = router;