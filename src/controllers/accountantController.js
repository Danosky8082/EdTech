const prisma = require('../config/database');

// Helper function for school filtering (add at the top)
const getSchoolFilter = (userSchool, isSuperAdmin) => {
    if (!userSchool || isSuperAdmin) return {};
    
    return {
        OR: [
            { student: { user: { school: userSchool } } },
            { parent: { user: { school: userSchool } } }
        ]
    };
};

// Accountant Dashboard - FIXED
const dashboard = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        console.log('📊 Loading accountant dashboard for:', userId);
        
        // Get accountant info
        const accountant = await prisma.accountant.findUnique({
            where: { userId: userId },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        avatar: true,
                        school: true
                    }
                }
            }
        });
        
        if (!accountant) {
            req.session.error_msg = 'Accountant profile not found';
            return res.redirect('/');
        }
        
        // Get school filter for parent payments
        const schoolFilter = getSchoolFilter(userSchool, isSuperAdmin);
        
        // DEBUG: Check what we're filtering for
        console.log('=== DEBUG: School Filter ===');
        console.log('schoolFilter:', JSON.stringify(schoolFilter));
        console.log('userSchool:', userSchool);
        console.log('isSuperAdmin:', isSuperAdmin);
        
        // Monthly revenue
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const monthlyRevenue = await prisma.parentPayment.aggregate({
            where: {
                status: 'completed',
                confirmedAt: {
                    gte: startOfMonth
                },
                ...schoolFilter
            },
            _sum: {
                amount: true
            }
        });

        // Yearly revenue
        const startOfYear = new Date();
        startOfYear.setMonth(0, 1);
        startOfYear.setHours(0, 0, 0, 0);
        
        const yearlyRevenue = await prisma.parentPayment.aggregate({
            where: {
                status: 'completed',
                confirmedAt: {
                    gte: startOfYear
                },
                ...schoolFilter
            },
            _sum: {
                amount: true
            }
        });

        // Payment status breakdown
        const paymentStatus = await prisma.parentPayment.groupBy({
            by: ['status'],
            _count: {
                id: true
            },
            where: {
                ...schoolFilter
            }
        });

        // Monthly trends (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        
        // Get parent payments for the last 6 months grouped by month
        const monthlyTrendsRaw = await prisma.parentPayment.findMany({
            where: {
                status: 'completed',
                confirmedAt: {
                    gte: sixMonthsAgo
                },
                ...schoolFilter
            },
            select: {
                amount: true,
                confirmedAt: true
            },
            orderBy: {
                confirmedAt: 'asc'
            }
        });

        // Group by month
        const monthlyTrends = {};
        monthlyTrendsRaw.forEach(payment => {
            if (payment.confirmedAt) {
                const monthYear = `${payment.confirmedAt.getFullYear()}-${(payment.confirmedAt.getMonth() + 1).toString().padStart(2, '0')}`;
                if (!monthlyTrends[monthYear]) {
                    monthlyTrends[monthYear] = 0;
                }
                monthlyTrends[monthYear] += payment.amount;
            }
        });

        // Recent high-value transactions
        const highValueTransactions = await prisma.parentPayment.findMany({
            where: {
                status: 'completed',
                amount: {
                    gt: 1000
                },
                ...schoolFilter
            },
            include: {
                parent: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                school: true
                            }
                        }
                    }
                },
                student: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                school: true
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
            orderBy: {
                amount: 'desc'
            },
            take: 10
        });

        // Get financial statistics (for compatibility)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        let financialWhereClause = {};
        if (userSchool && !isSuperAdmin) {
            financialWhereClause.school = userSchool;
        }
        
        // DEBUG: Check what's in the database - FIXED VERSION
        console.log('=== DEBUG: Data Counts ===');
        const debugData = await Promise.all([
            prisma.parentPayment.count({ where: schoolFilter }),
            prisma.financialTransaction.count({ where: financialWhereClause }),
            prisma.parentPayment.findMany({
                where: schoolFilter,
                select: { 
                    id: true, 
                    amount: true, 
                    status: true,
                    student: {
                        select: {
                            user: {
                                select: {
                                    school: true
                                }
                            }
                        }
                    },
                    parent: {
                        select: {
                            user: {
                                select: {
                                    school: true
                                }
                            }
                        }
                    }
                },
                take: 3
            }),
            prisma.financialTransaction.findMany({
                where: financialWhereClause,
                select: { 
                    id: true, 
                    amount: true, 
                    type: true, 
                    school: true 
                },
                take: 3
            })
        ]);
        
        console.log('Total parent payments:', debugData[0]);
        console.log('Total financial transactions:', debugData[1]);
        console.log('Sample parent payments:', debugData[2]);
        console.log('Sample financial transactions:', debugData[3]);
        
        // Get all statistics in parallel
        const [
            totalFinancialTransactions,
            todayFinancialTransactions,
            parentPaymentStats,
            financialIncome,
            financialExpenses,
            pendingPayments,
            recentTransactions,
            notifications,
            notificationCount
        ] = await Promise.all([
            // Total financial transactions
            prisma.financialTransaction.count({ 
                where: financialWhereClause 
            }),
            
            // Today's financial transactions
            prisma.financialTransaction.count({
                where: {
                    ...financialWhereClause,
                    date: {
                        gte: today,
                        lt: tomorrow
                    }
                }
            }),
            
            // Parent payment statistics (income from cashier module)
            prisma.parentPayment.aggregate({
                where: {
                    status: 'completed',
                    ...schoolFilter
                },
                _sum: { amount: true },
                _count: { id: true }
            }),
            
            // Total income from financial transactions
            prisma.financialTransaction.aggregate({
                where: {
                    ...financialWhereClause,
                    type: 'income'
                },
                _sum: { amount: true }
            }),
            
            // Total expenses from financial transactions
            prisma.financialTransaction.aggregate({
                where: {
                    ...financialWhereClause,
                    type: 'expense'
                },
                _sum: { amount: true }
            }),
            
            // Pending parent payments
            prisma.parentPayment.count({
                where: {
                    status: 'pending',
                    ...schoolFilter
                }
            }),
            
            // Recent financial transactions
            prisma.financialTransaction.findMany({
                where: financialWhereClause,
                include: {
                    creator: {
                        select: {
                            firstName: true,
                            lastName: true
                        }
                    }
                },
                orderBy: { date: 'desc' },
                take: 10
            }),
            
            // Get notifications
            prisma.notification.findMany({
                where: {
                    userId: userId,
                    read: false,
                    OR: [
                        { expiresAt: { gt: new Date() } },
                        { expiresAt: null }
                    ]
                },
                orderBy: { createdAt: 'desc' },
                take: 10
            }),
            
            // Notification count
            prisma.notification.count({
                where: {
                    userId: userId,
                    read: false,
                    OR: [
                        { expiresAt: { gt: new Date() } },
                        { expiresAt: null }
                    ]
                }
            })
        ]);
        
        // Calculate TODAY's parent payments
        const todayParentPayments = await prisma.parentPayment.count({
            where: {
                status: 'completed',
                confirmedAt: {
                    gte: today,
                    lt: tomorrow
                },
                ...schoolFilter
            }
        });
        
        // Calculate combined statistics
        const totalIncomeAmount = (parentPaymentStats._sum.amount || 0) + (financialIncome._sum.amount || 0);
        const totalExpensesAmount = financialExpenses._sum.amount || 0;
        const todayTransactionsCount = todayParentPayments + todayFinancialTransactions;
        const totalTransactionsCount = parentPaymentStats._count.id + totalFinancialTransactions;
        
        console.log('=== DEBUG: Statistics ===');
        console.log('Monthly Revenue:', monthlyRevenue._sum.amount);
        console.log('Pending Payments:', pendingPayments);
        console.log('Total Income:', totalIncomeAmount);
        console.log('Total Expenses:', totalExpensesAmount);
        console.log('Parent Payment Stats:', parentPaymentStats);
        console.log('Financial Income:', financialIncome._sum.amount);
        console.log('Financial Expenses:', financialExpenses._sum.amount);
        
        res.render('accountant/dashboard', {
            title: 'Accountant Dashboard',
            accountant: accountant,
            user: req.session.user,
            // New parent payment metrics
            monthlyRevenue: monthlyRevenue._sum.amount || 0,
            yearlyRevenue: yearlyRevenue._sum.amount || 0,
            paymentStatus,
            monthlyTrends,
            highValueTransactions,
            // Legacy financial transaction metrics (for compatibility)
            statistics: {
                totalTransactions: totalTransactionsCount,
                todayTransactions: todayTransactionsCount,
                totalIncome: totalIncomeAmount,
                totalExpenses: totalExpensesAmount,
                netBalance: totalIncomeAmount - totalExpensesAmount,
                pendingPayments
            },
            recentTransactions,
            notifications,
            notificationCount,
            userSchool,
            isSuperAdmin,
            error_msg: req.session.error_msg,
            success_msg: req.session.success_msg
        });
        
        // Clear session messages
        delete req.session.error_msg;
        delete req.session.success_msg;
        
    } catch (error) {
        console.error('💥 Accountant dashboard error:', error);
        console.error('Error stack:', error.stack);
        req.session.error_msg = 'Error loading dashboard: ' + error.message;
        res.redirect('/');
    }
};

// View Financial Transactions - FIXED
const viewTransactions = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        const { page = 1, type, startDate, endDate } = req.query;
        const limit = 50;
        const skip = (page - 1) * limit;
        
        let whereClause = {};
        
        // Define school filter properly
        if (userSchool && !isSuperAdmin) {
            whereClause.school = userSchool;
        }
        
        if (type) {
            whereClause.type = type;
        }
        
        if (startDate || endDate) {
            whereClause.date = {};
            if (startDate) whereClause.date.gte = new Date(startDate);
            if (endDate) whereClause.date.lte = new Date(endDate);
        }
        
        const [transactions, total, summary] = await Promise.all([
            prisma.financialTransaction.findMany({
                where: whereClause,
                include: {
                    creator: {
                        select: {
                            firstName: true,
                            lastName: true,
                            idNumber: true
                        }
                    }
                },
                orderBy: { date: 'desc' },
                skip: skip,
                take: limit
            }),
            
            prisma.financialTransaction.count({ where: whereClause }),
            
            prisma.financialTransaction.aggregate({
                where: whereClause,
                _sum: { amount: true },
                _count: { id: true }
            })
        ]);
        
        // Get type summary
        const incomeSummary = await prisma.financialTransaction.aggregate({
            where: { ...whereClause, type: 'income' },
            _sum: { amount: true }
        });
        
        const expenseSummary = await prisma.financialTransaction.aggregate({
            where: { ...whereClause, type: 'expense' },
            _sum: { amount: true }
        });
        
        res.render('accountant/transactions', {
            title: 'Financial Transactions',
            transactions,
            summary: {
                totalAmount: summary._sum.amount || 0,
                totalTransactions: summary._count.id,
                totalIncome: incomeSummary._sum.amount || 0,
                totalExpense: expenseSummary._sum.amount || 0
            },
            pagination: {
                page: parseInt(page),
                limit,
                total,
                pages: Math.ceil(total / limit)
            },
            filters: { type, startDate, endDate },
            userSchool,
            isSuperAdmin
        });
        
    } catch (error) {
        console.error('View transactions error:', error);
        res.status(500).render('error/500', { title: 'Server Error', message: error.message });
    }
};

// Create Transaction - KEEP AS IS (it's working)
const createTransaction = async (req, res) => {
    try {
        const { type, title, description, amount, date, category, receiptNumber, destination } = req.body;
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        
        if (!type || !title || !amount) {
            req.session.error_msg = 'Type, title, and amount are required';
            return res.redirect('/accountant/transactions');
        }
        
        await prisma.financialTransaction.create({
            data: {
                type,
                title,
                description,
                amount: parseFloat(amount),
                date: date ? new Date(date) : new Date(),
                category: category || 'general',
                receiptNumber,
                destination,
                school: userSchool,
                createdBy: userId,
                status: 'completed'
            }
        });
        
        req.session.success_msg = 'Transaction recorded successfully';
        res.redirect('/accountant/transactions');
        
    } catch (error) {
        console.error('Create transaction error:', error);
        req.session.error_msg = 'Failed to create transaction';
        res.redirect('/accountant/transactions');
    }
};

// View Reports - FIXED
const viewReports = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        // Build school filter for parent payments using helper function
        const schoolFilter = getSchoolFilter(userSchool, isSuperAdmin);
        
        // Get monthly data for the last 6 months
        const months = [];
        const incomeData = [];
        const expenseData = [];
        
        for (let i = 5; i >= 0; i--) {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
            const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
            
            months.push(date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
            
            const [monthIncome, monthExpense] = await Promise.all([
                // Parent payments income for the month
                prisma.parentPayment.aggregate({
                    where: {
                        ...schoolFilter,
                        status: 'completed',
                        confirmedAt: { 
                            gte: monthStart, 
                            lte: monthEnd 
                        }
                    },
                    _sum: { amount: true }
                }),
                
                // Financial transactions expenses for the month
                prisma.financialTransaction.aggregate({
                    where: {
                        school: userSchool && !isSuperAdmin ? userSchool : undefined,
                        type: 'expense',
                        date: { 
                            gte: monthStart, 
                            lte: monthEnd 
                        }
                    },
                    _sum: { amount: true }
                })
            ]);
            
            incomeData.push(monthIncome._sum.amount || 0);
            expenseData.push(monthExpense._sum.amount || 0);
        }
        
        // Get category breakdown from financial transactions
        const categories = await prisma.financialTransaction.groupBy({
            by: ['category'],
            where: {
                school: userSchool && !isSuperAdmin ? userSchool : undefined,
                type: 'expense'
            },
            _sum: { amount: true },
            orderBy: {
                _sum: { amount: 'desc' }
            },
            take: 10
        });
        
        res.render('accountant/reports', {
            title: 'Financial Reports',
            months,
            incomeData,
            expenseData,
            categories,
            userSchool,
            isSuperAdmin
        });
        
    } catch (error) {
        console.error('View reports error:', error);
        res.status(500).render('error/500', { title: 'Server Error', message: error.message });
    }
};

// Approve Payments - FIXED
const approvePayments = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        // Build school filter using helper function
        const schoolFilter = getSchoolFilter(userSchool, isSuperAdmin);
        
        const pendingPayments = await prisma.parentPayment.findMany({
            where: {
                status: 'pending',
                ...schoolFilter
            },
            include: {
                parent: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                idNumber: true,
                                school: true
                            }
                        }
                    }
                },
                student: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                school: true
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'asc' }
        });
        
        res.render('accountant/approve-payments', {
            title: 'Approve Payments',
            pendingPayments,
            userSchool,
            isSuperAdmin
        });
        
    } catch (error) {
        console.error('Approve payments error:', error);
        res.status(500).render('error/500', { title: 'Server Error', message: error.message });
    }
};

// Approve Payment - FIXED
const approvePayment = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { action } = req.body; // 'approve' or 'reject'
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        // Build school filter using helper function
        const schoolFilter = getSchoolFilter(userSchool, isSuperAdmin);
        
        // First check if payment exists and is in the user's school
        const payment = await prisma.parentPayment.findFirst({
            where: { 
                id: paymentId,
                ...schoolFilter
            }
        });
        
        if (!payment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Payment not found or not in your school' 
            });
        }
        
        if (action === 'approve') {
            await prisma.$transaction(async (tx) => {
                // Update payment status
                await tx.parentPayment.update({
                    where: { id: paymentId },
                    data: {
                        status: 'confirmed',
                        confirmedBy: userId,
                        confirmedAt: new Date()
                    }
                });
                
                // Update student tuition status
                const student = await tx.student.findUnique({
                    where: { id: payment.studentId }
                });
                
                if (student) {
                    await tx.student.update({
                        where: { id: payment.studentId },
                        data: {
                            tuitionStatus: 'paid',
                            canChangePassword: true,
                            tempPasswordExpiry: null
                        }
                    });
                    
                    // Create tuition payment record
                    await tx.tuitionPayment.create({
                        data: {
                            receiptNumber: payment.receiptNumber,
                            amount: payment.amount,
                            status: 'verified',
                            verifiedBy: userId,
                            verifiedAt: new Date(),
                            studentId: payment.studentId,
                            semester: `${new Date().getFullYear()}-1`
                        }
                    });
                }
                
                // Create notification for parent
                const parent = await tx.parent.findUnique({
                    where: { id: payment.parentId },
                    include: { user: true }
                });
                
                if (parent) {
                    await tx.notification.create({
                        data: {
                            userId: parent.userId,
                            title: 'Payment Approved',
                            message: `Your payment of =N=${payment.amount.toFixed(2)} has been approved.`,
                            icon: 'fas fa-check-circle',
                            type: 'payment_approved'
                        }
                    });
                }
            });
            
            res.json({ success: true, message: 'Payment approved successfully' });
            
        } else if (action === 'reject') {
            await prisma.parentPayment.update({
                where: { id: paymentId },
                data: {
                    status: 'rejected',
                    rejectedAt: new Date(),
                    reason: req.body.reason || 'Payment rejected'
                }
            });
            
            // Refund to wallet if payment was from wallet
            if (payment.paymentMethod === 'wallet') {
                const parent = await prisma.parent.findUnique({
                    where: { id: payment.parentId },
                    include: { wallet: true }
                });
                
                if (parent && parent.wallet) {
                    await prisma.wallet.update({
                        where: { id: parent.wallet.id },
                        data: {
                            balance: {
                                increment: payment.amount
                            }
                        }
                    });
                    
                    await prisma.transaction.create({
                        data: {
                            walletId: parent.wallet.id,
                            amount: payment.amount,
                            type: 'refund',
                            description: `Refund for rejected payment: ${payment.receiptNumber}`,
                            status: 'completed'
                        }
                    });
                }
            }
            
            res.json({ success: true, message: 'Payment rejected successfully' });
        }
        
    } catch (error) {
        console.error('Approve payment error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + error.message 
        });
    }
};

// Audit Trail - FIXED
const auditTrail = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        const { page = 1 } = req.query;
        const limit = 100;
        const skip = (page - 1) * limit;
        
        let whereClause = {};
        if (userSchool && !isSuperAdmin) {
            whereClause.school = userSchool;
        }
        
        const [transactions, total] = await Promise.all([
            prisma.financialTransaction.findMany({
                where: whereClause,
                include: {
                    creator: {
                        select: {
                            firstName: true,
                            lastName: true,
                            idNumber: true,
                            role: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip: skip,
                take: limit
            }),
            prisma.financialTransaction.count({ where: whereClause })
        ]);
        
        // Get user activity
        const userActivity = await prisma.user.findMany({
            where: {
                school: userSchool,
                OR: [
                    { role: 'admin' },
                    { role: 'cashier' },
                    { role: 'accountant' }
                ]
            },
            select: {
                idNumber: true,
                firstName: true,
                lastName: true,
                role: true,
                createdAt: true
            },
            take: 20
        });
        
        res.render('accountant/audit', {
            title: 'Audit Trail',
            transactions,
            userActivity,
            pagination: {
                page: parseInt(page),
                limit,
                total,
                pages: Math.ceil(total / limit)
            },
            userSchool,
            isSuperAdmin
        });
        
    } catch (error) {
        console.error('Audit trail error:', error);
        res.status(500).render('error/500', { title: 'Server Error', message: error.message });
    }
};

// API endpoint for financial reports data
const getFinancialReportsData = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        const { period = '30days', startDate, endDate } = req.query;
        
        // Calculate date range based on period
        let dateRange = {};
        const now = new Date();
        
        if (startDate && endDate) {
            // Custom date range
            dateRange.start = new Date(startDate);
            dateRange.end = new Date(endDate);
        } else {
            // Predefined periods
            switch (period) {
                case '7days':
                    dateRange.start = new Date(now.setDate(now.getDate() - 7));
                    dateRange.end = new Date();
                    break;
                case '90days':
                    dateRange.start = new Date(now.setDate(now.getDate() - 90));
                    dateRange.end = new Date();
                    break;
                case 'month':
                    dateRange.start = new Date(now.getFullYear(), now.getMonth(), 1);
                    dateRange.end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                    break;
                case 'quarter':
                    const quarter = Math.floor(now.getMonth() / 3);
                    dateRange.start = new Date(now.getFullYear(), quarter * 3, 1);
                    dateRange.end = new Date(now.getFullYear(), quarter * 3 + 3, 0);
                    break;
                case 'year':
                    dateRange.start = new Date(now.getFullYear(), 0, 1);
                    dateRange.end = new Date(now.getFullYear(), 11, 31);
                    break;
                case '30days':
                default:
                    dateRange.start = new Date(now.setDate(now.getDate() - 30));
                    dateRange.end = new Date();
                    break;
            }
        }
        
        // Build school filter
        const schoolFilter = userSchool && !isSuperAdmin 
            ? { school: userSchool }
            : {};
        
        // Get income data (parent payments)
        const parentPaymentIncome = await prisma.parentPayment.aggregate({
            where: {
                ...schoolFilter,
                status: 'completed',
                confirmedAt: {
                    gte: dateRange.start,
                    lte: dateRange.end
                }
            },
            _sum: { amount: true }
        });
        
        // Get financial transaction data
        const financialTransactions = await prisma.financialTransaction.aggregate({
            where: {
                ...schoolFilter,
                date: {
                    gte: dateRange.start,
                    lte: dateRange.end
                }
            },
            _sum: { amount: true },
            _count: { id: true }
        });
        
        // Get income by category
        const incomeByCategory = await prisma.financialTransaction.groupBy({
            by: ['category'],
            where: {
                ...schoolFilter,
                type: 'income',
                date: {
                    gte: dateRange.start,
                    lte: dateRange.end
                }
            },
            _sum: { amount: true },
            orderBy: {
                _sum: { amount: 'desc' }
            }
        });
        
        // Get expense categories
        const expenseCategories = await prisma.financialTransaction.groupBy({
            by: ['category'],
            where: {
                ...schoolFilter,
                type: 'expense',
                date: {
                    gte: dateRange.start,
                    lte: dateRange.end
                }
            },
            _sum: { amount: true },
            orderBy: {
                _sum: { amount: 'desc' }
            }
        });
        
        // Generate monthly data for charts (last 6 months)
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
                prisma.parentPayment.aggregate({
                    where: {
                        ...schoolFilter,
                        status: 'completed',
                        confirmedAt: { 
                            gte: monthStart, 
                            lte: monthEnd 
                        }
                    },
                    _sum: { amount: true }
                }),
                prisma.financialTransaction.aggregate({
                    where: {
                        ...schoolFilter,
                        type: 'expense',
                        date: { 
                            gte: monthStart, 
                            lte: monthEnd 
                        }
                    },
                    _sum: { amount: true }
                })
            ]);
            
            incomeData.push((monthIncome._sum.amount || 0) + (monthExpense._sum.amount || 0));
            expenseData.push(monthExpense._sum.amount || 0);
        }
        
        res.json({
            success: true,
            data: {
                totalIncome: (parentPaymentIncome._sum.amount || 0) + (financialTransactions._sum.amount || 0),
                totalExpenses: expenseCategories.reduce((sum, cat) => sum + (cat._sum.amount || 0), 0),
                transactionCount: financialTransactions._count.id,
                incomeByCategory,
                expenseCategories,
                months,
                incomeData,
                expenseData,
                dateRange: {
                    start: dateRange.start.toISOString().split('T')[0],
                    end: dateRange.end.toISOString().split('T')[0]
                }
            }
        });
        
    } catch (error) {
        console.error('Financial reports API error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};


// API endpoint for today's activities count
const getTodayActivities = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        const { date } = req.query;
        
        let whereClause = {};
        if (userSchool && !isSuperAdmin) {
            whereClause.school = userSchool;
        }
        
        if (date) {
            const today = new Date(date);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            whereClause.createdAt = {
                gte: today,
                lt: tomorrow
            };
        }
        
        const todayCount = await prisma.financialTransaction.count({
            where: whereClause
        });
        
        res.json({
            success: true,
            count: todayCount,
            date: date || new Date().toISOString().split('T')[0]
        });
        
    } catch (error) {
        console.error('Today activities API error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// API endpoint for detailed audit log
const getAuditLogDetails = async (req, res) => {
    try {
        const { logId } = req.params;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        let whereClause = { id: logId };
        if (userSchool && !isSuperAdmin) {
            whereClause.school = userSchool;
        }
        
        const log = await prisma.financialTransaction.findUnique({
            where: whereClause,
            include: {
                creator: {
                    select: {
                        firstName: true,
                        lastName: true,
                        idNumber: true,
                        role: true,
                        email: true,
                        lastLoginAt: true
                    }
                }
            }
        });
        
        if (!log) {
            return res.status(404).json({
                success: false,
                message: 'Audit log not found'
            });
        }
        
        // Get related logs from same session/user
        const relatedLogs = await prisma.financialTransaction.findMany({
            where: {
                createdBy: log.createdBy,
                createdAt: {
                    gte: new Date(log.createdAt.getTime() - 24 * 60 * 60 * 1000), // Last 24 hours
                    lte: log.createdAt
                }
            },
            select: {
                id: true,
                type: true,
                amount: true,
                title: true,
                createdAt: true
            },
            take: 10,
            orderBy: { createdAt: 'desc' }
        });
        
        res.json({
            success: true,
            data: {
                ...log,
                relatedLogs,
                ipAddress: '192.168.1.100', // In production, store this in your logs
                deviceInfo: 'Chrome on Windows 10',
                riskLevel: 'low',
                sessionId: 'SESS-' + Math.random().toString(36).substr(2, 9)
            }
        });
        
    } catch (error) {
        console.error('Audit log details API error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// API endpoint for advanced search
const searchAuditLogs = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        const { 
            keywords, 
            startDate, 
            endDate, 
            minAmount, 
            maxAmount, 
            type, 
            category,
            userId,
            page = 1,
            limit = 50
        } = req.query;
        
        const skip = (page - 1) * limit;
        
        let whereClause = {};
        if (userSchool && !isSuperAdmin) {
            whereClause.school = userSchool;
        }
        
        // Build search conditions
        if (keywords) {
            whereClause.OR = [
                { title: { contains: keywords, mode: 'insensitive' } },
                { description: { contains: keywords, mode: 'insensitive' } },
                { receiptNumber: { contains: keywords, mode: 'insensitive' } }
            ];
        }
        
        if (type) {
            whereClause.type = type;
        }
        
        if (category) {
            whereClause.category = category;
        }
        
        if (userId) {
            whereClause.createdBy = userId;
        }
        
        if (startDate || endDate) {
            whereClause.createdAt = {};
            if (startDate) whereClause.createdAt.gte = new Date(startDate);
            if (endDate) whereClause.createdAt.lte = new Date(endDate);
        }
        
        if (minAmount || maxAmount) {
            whereClause.amount = {};
            if (minAmount) whereClause.amount.gte = parseFloat(minAmount);
            if (maxAmount) whereClause.amount.lte = parseFloat(maxAmount);
        }
        
        const [logs, total] = await Promise.all([
            prisma.financialTransaction.findMany({
                where: whereClause,
                include: {
                    creator: {
                        select: {
                            firstName: true,
                            lastName: true,
                            idNumber: true,
                            role: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip: skip,
                take: parseInt(limit)
            }),
            prisma.financialTransaction.count({ where: whereClause })
        ]);
        
        res.json({
            success: true,
            data: {
                logs,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                searchCriteria: {
                    keywords,
                    startDate,
                    endDate,
                    type,
                    category,
                    minAmount,
                    maxAmount
                }
            }
        });
        
    } catch (error) {
        console.error('Audit search API error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};



module.exports = {
    dashboard,
    viewTransactions,
    createTransaction,
    viewReports,
    approvePayments,
    approvePayment,
    auditTrail,
    getFinancialReportsData,
    getTodayActivities,
    getAuditLogDetails,
    searchAuditLogs
};