const prisma = require('../config/database');

// Cashier Dashboard - UPDATED
const dashboard = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        console.log('💰 Loading cashier dashboard for:', userId);
        console.log('🏫 School context:', userSchool);
        
        // Get cashier info
        const cashier = await prisma.cashier.findUnique({
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
        
        if (!cashier) {
            req.session.error_msg = 'Cashier profile not found';
            return res.redirect('/');
        }
        
        // Create base query conditions for school filtering
        const getSchoolFilter = (tableName) => {
            if (!userSchool || isSuperAdmin) return {};
            
            switch(tableName) {
                case 'parentPayment':
                    return {
                        OR: [
                            { 
                                student: { 
                                    user: { 
                                        school: userSchool 
                                    } 
                                } 
                            },
                            { 
                                parent: { 
                                    user: { 
                                        school: userSchool 
                                    } 
                                } 
                            }
                        ]
                    };
                case 'dailyTransaction':
                    // First try to filter by school field
                    return {
                        school: userSchool
                    };
                default:
                    return {};
            }
        };
        
        // Today's date range
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Get today's parent payments WITH SCHOOL FILTER
        const todaysPayments = await prisma.parentPayment.count({
            where: {
                status: 'completed',
                confirmedAt: {
                    gte: today,
                    lt: tomorrow
                },
                ...getSchoolFilter('parentPayment')
            }
        });

        // Pending parent payments WITH SCHOOL FILTER
        const pendingPayments = await prisma.parentPayment.count({
            where: {
                status: 'pending',
                ...getSchoolFilter('parentPayment')
            }
        });

        // Total revenue WITH SCHOOL FILTER
        const revenueResult = await prisma.parentPayment.aggregate({
            where: {
                status: 'completed',
                ...getSchoolFilter('parentPayment')
            },
            _sum: {
                amount: true
            }
        });

        // Recent payments WITH SCHOOL FILTER
        const recentPayments = await prisma.parentPayment.findMany({
            where: {
                ...getSchoolFilter('parentPayment')
            },
            include: {
                parent: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true,
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
                                email: true,
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
                createdAt: 'desc'
            },
            take: 10
        });

        // Pending payments for confirmation WITH SCHOOL FILTER
        const pendingForConfirmation = await prisma.parentPayment.findMany({
            where: {
                status: 'pending',
                ...getSchoolFilter('parentPayment')
            },
            include: {
                parent: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true,
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
                                email: true,
                                school: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 20
        });

        // Today's daily transactions WITH SCHOOL FILTER
        const todayDaily = {
            ...getSchoolFilter('dailyTransaction'),
            createdAt: {
                gte: today,
                lt: tomorrow
            }
        };
        
        // Get all queries with school filtering
        const [
            todaySummary,
            feePaymentsToday,
            otherIncomeToday,
            expensesToday,
            recentTransactions,
            notifications,
            notificationCount
        ] = await Promise.all([
            // Today's total from daily transactions
            prisma.dailyTransaction.aggregate({
                where: todayDaily,
                _sum: { amount: true },
                _count: { id: true }
            }),
            
            // Today's fee payments from daily transactions
            prisma.dailyTransaction.aggregate({
                where: { ...todayDaily, type: 'fee_payment' },
                _sum: { amount: true },
                _count: { id: true }
            }),
            
            // Today's other income from daily transactions
            prisma.dailyTransaction.aggregate({
                where: { ...todayDaily, type: 'other_income' },
                _sum: { amount: true }
            }),
            
            // Today's expenses from daily transactions
            prisma.dailyTransaction.aggregate({
                where: { ...todayDaily, type: 'expense' },
                _sum: { amount: true }
            }),
            
            // Recent daily transactions WITH SCHOOL FILTER
            prisma.dailyTransaction.findMany({
                where: getSchoolFilter('dailyTransaction'),
                include: {
                    collector: {
                        select: {
                            firstName: true,
                            lastName: true,
                            idNumber: true
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
                    }
                },
                orderBy: { createdAt: 'desc' },
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
        
        // Debug log to check filtering
        console.log(`Filtering by school: ${userSchool}`);
        console.log(`Found ${recentPayments.length} recent payments`);
        console.log(`Found ${recentTransactions.length} recent transactions`);
        
        res.render('cashier/dashboard', {
            title: 'Cashier Dashboard',
            cashier: cashier,
            user: req.session.user,
            // New parent payment metrics
            todaysPayments,
            pendingPayments,
            totalRevenue: revenueResult._sum.amount || 0,
            recentPayments,
            pendingForConfirmation,
            // Legacy daily transaction metrics (for compatibility)
            today: {
                total: todaySummary._sum.amount || 0,
                transactionCount: todaySummary._count.id,
                feePayments: feePaymentsToday._sum.amount || 0,
                feePaymentCount: feePaymentsToday._count.id,
                otherIncome: otherIncomeToday._sum.amount || 0,
                expenses: expensesToday._sum.amount || 0,
                netBalance: (todaySummary._sum.amount || 0) - (expensesToday._sum.amount || 0)
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
        console.error('💥 Cashier dashboard error:', error);
        req.session.error_msg = 'Error loading dashboard';
        res.redirect('/');
    }
};

// View payment details (GET route)
const viewPaymentDetails = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        console.log('🔍 Viewing payment details:', paymentId);
        
        // Build school filter
        const schoolFilter = userSchool && !isSuperAdmin 
            ? {
                OR: [
                    { student: { user: { school: userSchool } } },
                    { parent: { user: { school: userSchool } } }
                ]
            }
            : {};
        
        const payment = await prisma.parentPayment.findUnique({
            where: { 
                id: paymentId,
                ...schoolFilter
            },
            include: {
                parent: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true,
                                phone: true,
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
                                grade: true,
                                section: true,
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
            }
        });
        
        if (!payment) {
            req.session.error_msg = 'Payment not found or not in your school';
            return res.redirect('/cashier/pending-payments');
        }
        
        res.render('cashier/payment-details', {
            title: 'Payment Details',
            payment,
            userSchool,
            isSuperAdmin
        });
        
    } catch (error) {
        console.error('View payment details error:', error);
        req.session.error_msg = 'Failed to load payment details';
        res.redirect('/cashier/pending-payments');
    }
};

// Process payment (POST route)
const processPayment = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        console.log('✅ Processing parent payment:', paymentId);
        
        // Build school filter
        const schoolFilter = userSchool && !isSuperAdmin 
            ? {
                OR: [
                    { student: { user: { school: userSchool } } },
                    { parent: { user: { school: userSchool } } }
                ]
            }
            : {};
        
        const payment = await prisma.parentPayment.findUnique({
            where: { 
                id: paymentId,
                ...schoolFilter
            },
            include: {
                parent: {
                    include: { 
                        user: true 
                    }
                },
                student: {
                    include: { 
                        user: true 
                    }
                }
            }
        });
        
        if (!payment) {
            req.session.error_msg = 'Payment not found or not in your school';
            return res.redirect('/cashier/pending-payments');
        }
        
        if (payment.status !== 'pending') {
            req.session.error_msg = `Payment is already ${payment.status}`;
            return res.redirect(`/cashier/payment/${paymentId}`);
        }
        
        await prisma.$transaction(async (tx) => {
            // Update payment status
            await tx.parentPayment.update({
                where: { id: paymentId },
                data: {
                    status: 'completed',
                    processedAt: new Date(),
                    processedBy: userId
                }
            });
            
            // Update student tuition status
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
            
            // Create daily transaction record
            await tx.dailyTransaction.create({
                data: {
                    type: 'fee_payment',
                    parentId: payment.parentId,
                    studentId: payment.studentId,
                    amount: payment.amount,
                    paymentMethod: payment.paymentMethod,
                    receiptNumber: payment.receiptNumber,
                    description: `Parent payment: ${payment.description}`,
                    status: 'completed',
                    collectedBy: userId,
                    school: payment.parent.user.school,
                    tuitionStatus: 'full',
                    semester: `${new Date().getFullYear()}-1`
                }
            });
            
            // Create notification for parent (REMOVED 'type' field)
            await tx.notification.create({
                data: {
                    userId: payment.parent.userId,
                    title: 'Payment Confirmed',
                    message: `Your payment of ₦${payment.amount.toFixed(2)} has been confirmed. Thank you!`,
                    icon: 'fas fa-check-circle'
                }
            });
        });
        
        console.log('✅ Payment processed successfully');
        req.session.success_msg = 'Payment confirmed successfully';
        res.redirect('/cashier/dashboard');
        
    } catch (error) {
        console.error('💥 Process payment error:', error);
        req.session.error_msg = 'Failed to process payment: ' + error.message;
        res.redirect(`/cashier/payment/${paymentId}`);
    }
};

// Reject payment (POST route) - FIXED
const rejectParentPayment = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { reason } = req.body;
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        console.log('❌ Rejecting parent payment:', paymentId);
        
        // Validate rejection reason
        if (!reason || reason.trim().length < 3) {
            req.session.error_msg = 'Please provide a valid rejection reason (minimum 3 characters)';
            return res.redirect(`/cashier/payment/${paymentId}`);
        }
        
        // Build school filter
        const schoolFilter = userSchool && !isSuperAdmin 
            ? {
                OR: [
                    { student: { user: { school: userSchool } } },
                    { parent: { user: { school: userSchool } } }
                ]
            }
            : {};
        
        const payment = await prisma.parentPayment.findUnique({
            where: { 
                id: paymentId,
                ...schoolFilter
            },
            include: {
                parent: {
                    include: { 
                        user: true 
                    }
                },
                student: {
                    include: { 
                        user: true 
                    }
                }
            }
        });
        
        if (!payment) {
            req.session.error_msg = 'Payment not found or not in your school';
            return res.redirect('/cashier/pending-payments');
        }
        
        if (payment.status !== 'pending') {
            req.session.error_msg = `Payment is already ${payment.status}`;
            return res.redirect(`/cashier/payment/${paymentId}`);
        }
        
        await prisma.$transaction(async (tx) => {
            // Update payment status to rejected
            await tx.parentPayment.update({
                where: { id: paymentId },
                data: {
                    status: 'rejected',
                    reason: reason.trim(), // Using 'reason' field from your schema
                    rejectedAt: new Date(),
                    confirmedBy: userId, // Record who rejected it
                    confirmedAt: new Date() // Also update confirmedAt since it's used by both approve/reject
                }
            });
            
            // Optional: If this was a wallet payment, refund the amount
            if (payment.paymentMethod === 'wallet') {
                // Check if parent has a wallet
                const wallet = await tx.wallet.findUnique({
                    where: { parentId: payment.parentId }
                });
                
                if (wallet) {
                    // Refund to wallet
                    await tx.wallet.update({
                        where: { parentId: payment.parentId },
                        data: {
                            balance: {
                                increment: payment.amount
                            }
                        }
                    });
                    
                    // Create transaction record for refund
                    await tx.transaction.create({
                        data: {
                            walletId: wallet.id,
                            amount: payment.amount,
                            type: 'refund',
                            description: `Payment refund: ${reason.trim().substring(0, 50)}...`,
                            status: 'completed',
                            referenceId: paymentId
                        }
                    });
                    
                    // Optional: Create savings deposit if this was for a savings goal
                    if (payment.description && payment.description.toLowerCase().includes('savings')) {
                        const savingsGoal = await tx.savingsGoal.findFirst({
                            where: {
                                parentId: payment.parentId,
                                isActive: true
                            }
                        });
                        
                        if (savingsGoal) {
                            await tx.savingsDeposit.create({
                                data: {
                                    savingsGoalId: savingsGoal.id,
                                    amount: payment.amount,
                                    description: `Refund for rejected payment: ${payment.receiptNumber}`,
                                    status: 'completed'
                                }
                            });
                        }
                    }
                }
            }
            
            // Optional: Create notification for parent
            await tx.notification.create({
                data: {
                    userId: payment.parent.userId,
                    title: 'Payment Rejected',
                    message: `Your payment of ₦${payment.amount.toFixed(2)} for ${payment.student.user.firstName} has been rejected. Reason: ${reason.trim()}`,
                    icon: 'times-circle',
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
                }
            });
            
            // Optional: Create financial transaction record for accounting
            if (userSchool) {
                await tx.financialTransaction.create({
                    data: {
                        type: 'payment_rejected',
                        title: `Payment Rejected - ${payment.receiptNumber}`,
                        description: `Payment rejected for ${payment.student.user.firstName} ${payment.student.user.lastName}. Reason: ${reason.trim()}`,
                        amount: payment.amount,
                        collector: payment.parent.user.firstName + ' ' + payment.parent.user.lastName,
                        category: 'tuition',
                        receiptNumber: payment.receiptNumber,
                        status: 'rejected',
                        school: userSchool,
                        createdBy: userId
                    }
                });
            }
        });
        
        // Set success message and redirect
        req.session.success_msg = 'Payment rejected successfully';
        res.redirect('/cashier/pending-payments');
        
    } catch (error) {
        console.error('❌ Reject parent payment error:', error);
        req.session.error_msg = `Failed to reject payment: ${error.message}`;
        res.redirect(`/cashier/payment/${req.params.paymentId}`);
    }
};

// Approve Parent Payment - UPDATED with school filter (FIXED for schema and enhanced)
const approveParentPayment = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        console.log('✅ Approving parent payment:', paymentId);
        
        // Build school filter
        const schoolFilter = userSchool && !isSuperAdmin 
            ? {
                OR: [
                    { student: { user: { school: userSchool } } },
                    { parent: { user: { school: userSchool } } }
                ]
            }
            : {};
        
        const payment = await prisma.parentPayment.findUnique({
            where: { 
                id: paymentId,
                ...schoolFilter
            },
            include: {
                parent: {
                    include: { 
                        user: true 
                    }
                },
                student: {
                    include: { 
                        user: true 
                    }
                }
            }
        });
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found or not in your school'
            });
        }
        
        if (payment.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Payment is already ${payment.status}`
            });
        }
        
        await prisma.$transaction(async (tx) => {
            // Update payment status - CORRECTED for your schema
            await tx.parentPayment.update({
                where: { id: paymentId },
                data: {
                    status: 'completed',
                    confirmedBy: userId,
                    confirmedAt: new Date(),
                    // Note: processedAt and processedBy don't exist in your schema
                }
            });
            
            // Update student tuition status
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
            
            // Handle wallet payment if applicable
            if (payment.paymentMethod === 'wallet') {
                // Deduct from wallet balance
                const wallet = await tx.wallet.findUnique({
                    where: { parentId: payment.parentId }
                });
                
                if (wallet) {
                    await tx.wallet.update({
                        where: { parentId: payment.parentId },
                        data: {
                            balance: {
                                decrement: payment.amount
                            }
                        }
                    });
                    
                    // Create transaction record for wallet deduction
                    await tx.transaction.create({
                        data: {
                            walletId: wallet.id,
                            amount: payment.amount,
                            type: 'payment',
                            description: `Tuition payment for ${payment.student.user.firstName} ${payment.student.user.lastName}`,
                            status: 'completed',
                            referenceId: paymentId
                        }
                    });
                }
            } else {
                // For non-wallet payments (card, transfer, cash), create a transaction for accounting
                // This might represent money coming into the school
                await tx.transaction.create({
                    data: {
                        walletId: null, // No wallet involved
                        amount: payment.amount,
                        type: 'deposit',
                        description: `School fee payment via ${payment.paymentMethod}: ${payment.description || 'Tuition'}`,
                        status: 'completed',
                        referenceId: paymentId
                    }
                });
            }
            
            // Create daily transaction record
            await tx.dailyTransaction.create({
                data: {
                    type: 'fee_payment',
                    parentId: payment.parentId,
                    studentId: payment.studentId,
                    amount: payment.amount,
                    paymentMethod: payment.paymentMethod,
                    receiptNumber: payment.receiptNumber,
                    description: `Parent payment: ${payment.description || 'Tuition fee'}`,
                    status: 'completed',
                    collectedBy: userId,
                    school: payment.parent.user.school || payment.student.user.school,
                    tuitionStatus: 'full',
                    semester: `${new Date().getFullYear()}-1`
                }
            });
            
            // Create financial transaction record
            await tx.financialTransaction.create({
                data: {
                    type: 'tuition_payment',
                    title: `Tuition Payment - ${payment.receiptNumber}`,
                    description: `Payment from ${payment.parent.user.firstName} ${payment.parent.user.lastName} for ${payment.student.user.firstName} ${payment.student.user.lastName}`,
                    amount: payment.amount,
                    collector: `${payment.parent.user.firstName} ${payment.parent.user.lastName}`,
                    destination: 'School Account',
                    category: 'tuition',
                    receiptNumber: payment.receiptNumber,
                    status: 'completed',
                    school: payment.parent.user.school || payment.student.user.school,
                    createdBy: userId
                }
            });
            
            // Create notification for parent
            await tx.notification.create({
                data: {
                    userId: payment.parent.userId,
                    title: 'Payment Confirmed',
                    message: `Your payment of ₦${payment.amount.toFixed(2)} has been confirmed. Thank you!`,
                    icon: 'fas fa-check-circle'
                }
            });
            
            // Optional: Update any savings goals if this payment was for savings
            if (payment.description && payment.description.toLowerCase().includes('savings')) {
                const activeSavingsGoal = await tx.savingsGoal.findFirst({
                    where: {
                        parentId: payment.parentId,
                        isActive: true
                    }
                });
                
                if (activeSavingsGoal) {
                    // Update savings goal current amount
                    await tx.savingsGoal.update({
                        where: { id: activeSavingsGoal.id },
                        data: {
                            currentAmount: {
                                increment: payment.amount
                            }
                        }
                    });
                    
                    // Create savings deposit record
                    await tx.savingsDeposit.create({
                        data: {
                            savingsGoalId: activeSavingsGoal.id,
                            amount: payment.amount,
                            description: `Payment for ${payment.description}`,
                            status: 'completed'
                        }
                    });
                }
            }
        });
        
        console.log('✅ Parent payment approved successfully');
        
        // Check if the request expects HTML redirect or JSON
        if (req.headers.accept && req.headers.accept.includes('text/html')) {
            // This is likely coming from a form submission, redirect with flash message
            req.flash('success', 'Payment approved successfully');
            res.redirect('/cashier/pending-approve');
        } else {
            // This is likely an API/JSON request
            res.json({
                success: true,
                message: 'Payment approved successfully'
            });
        }
        
    } catch (error) {
        console.error('💥 Approve parent payment error:', error);
        
        // Check if the request expects HTML redirect or JSON
        if (req.headers.accept && req.headers.accept.includes('text/html')) {
            req.flash('error', `Failed to approve payment: ${error.message}`);
            res.redirect(`/cashier/payment/${req.params.paymentId}`);
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to approve payment: ' + error.message
            });
        }
    }
};

// Record Fee Payment - UPDATED with fixed notification
const recordFeePayment = async (req, res) => {
    try {
        const { studentId, amount, paymentMethod, receiptNumber, description, tuitionStatus, semester } = req.body;
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        
        console.log('💳 Recording fee payment:', { studentId, amount });
        
        // Validate required fields
        if (!studentId || !amount || !paymentMethod) {
            return res.status(400).json({
                success: false,
                message: 'Student ID, amount, and payment method are required'
            });
        }
        
        // Check if student exists
        const student = await prisma.student.findUnique({
            where: { id: studentId },
            include: { user: true }
        });
        
        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }
        
        // Generate receipt number if not provided
        const finalReceiptNumber = receiptNumber || `REC-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        
        // Check if receipt number already exists
        const existingReceipt = await prisma.dailyTransaction.findUnique({
            where: { receiptNumber: finalReceiptNumber }
        });
        
        if (existingReceipt) {
            return res.status(400).json({
                success: false,
                message: 'Receipt number already exists'
            });
        }
        
        // Create transaction record
        const transaction = await prisma.dailyTransaction.create({
            data: {
                type: 'fee_payment',
                studentId: studentId,
                amount: parseFloat(amount),
                paymentMethod: paymentMethod,
                receiptNumber: finalReceiptNumber,
                description: description || `Tuition fee payment for ${student.user.firstName} ${student.user.lastName}`,
                status: 'completed',
                collectedBy: userId,
                school: userSchool,
                tuitionStatus: tuitionStatus || 'partial',
                semester: semester || `${new Date().getFullYear()}-1`,
                academicYear: new Date().getFullYear().toString()
            }
        });
        
        // Update student tuition status
        await prisma.student.update({
            where: { id: studentId },
            data: {
                tuitionStatus: tuitionStatus === 'full' ? 'paid' : 'partial',
                canChangePassword: tuitionStatus === 'full',
                tempPasswordExpiry: tuitionStatus === 'full' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }
        });
        
        // Create tuition payment record
        await prisma.tuitionPayment.create({
            data: {
                receiptNumber: finalReceiptNumber,
                amount: parseFloat(amount),
                status: 'verified',
                verifiedBy: userId,
                verifiedAt: new Date(),
                studentId: studentId,
                semester: semester || `${new Date().getFullYear()}-1`
            }
        });
        
        // Create notification for admin (REMOVED 'type' field)
        const admins = await prisma.user.findMany({
            where: {
                role: 'admin',
                school: userSchool
            }
        });
        
        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    userId: admin.id,
                    title: 'New Fee Payment',
                    message: `Cashier recorded a fee payment of ₦${amount} for ${student.user.firstName} ${student.user.lastName}`,
                    icon: 'fas fa-money-bill-wave'
                }
            });
        }
        
        console.log('✅ Fee payment recorded successfully');
        
        res.json({
            success: true,
            message: 'Fee payment recorded successfully',
            receiptNumber: finalReceiptNumber,
            transaction: transaction
        });
        
    } catch (error) {
        console.error('💥 Record fee payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record fee payment: ' + error.message
        });
    }
};

// Record Other Transaction - UPDATED with fixed notification
const recordOtherTransaction = async (req, res) => {
    try {
        const { type, amount, paymentMethod, receiptNumber, description, category } = req.body;
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        
        console.log('💰 Recording other transaction:', { type, amount });
        
        if (!type || !amount || !paymentMethod) {
            return res.status(400).json({
                success: false,
                message: 'Type, amount, and payment method are required'
            });
        }
        
        const finalReceiptNumber = receiptNumber || `OTH-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        
        // Check if receipt number exists
        const existingReceipt = await prisma.dailyTransaction.findUnique({
            where: { receiptNumber: finalReceiptNumber }
        });
        
        if (existingReceipt) {
            return res.status(400).json({
                success: false,
                message: 'Receipt number already exists'
            });
        }
        
        const transaction = await prisma.dailyTransaction.create({
            data: {
                type: type, // 'other_income' or 'expense'
                amount: parseFloat(amount),
                paymentMethod: paymentMethod,
                receiptNumber: finalReceiptNumber,
                description: description || `${type} transaction`,
                status: 'completed',
                collectedBy: userId,
                school: userSchool,
                category: category || 'general'
            }
        });
        
        // Create financial transaction record for accountant
        await prisma.financialTransaction.create({
            data: {
                type: type,
                title: description || `${type} transaction`,
                description: `Recorded by cashier: ${description || ''}`,
                amount: parseFloat(amount),
                date: new Date(),
                category: category || 'general',
                receiptNumber: finalReceiptNumber,
                school: userSchool,
                createdBy: userId,
                status: 'completed'
            }
        });
        
        // Create notification for accountant (REMOVED 'type' field)
        const accountants = await prisma.user.findMany({
            where: {
                role: 'accountant',
                school: userSchool
            }
        });
        
        for (const accountant of accountants) {
            await prisma.notification.create({
                data: {
                    userId: accountant.id,
                    title: 'New Transaction',
                    message: `Cashier recorded a ${type} transaction of ₦${amount}`,
                    icon: type === 'expense' ? 'fas fa-receipt' : 'fas fa-money-bill'
                }
            });
        }
        
        console.log('✅ Other transaction recorded successfully');
        
        res.json({
            success: true,
            message: 'Transaction recorded successfully',
            receiptNumber: finalReceiptNumber,
            transaction: transaction
        });
        
    } catch (error) {
        console.error('💥 Record other transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record transaction: ' + error.message
        });
    }
};

// Get Students for Payment - KEEP AS IS (it's working)
const getStudentsForPayment = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        const { grade, section, search } = req.query;
        
        let whereClause = {};
        
        if (userSchool && !isSuperAdmin) {
            whereClause.user = { school: userSchool };
        }
        
        if (grade) {
            whereClause.grade = grade;
        }
        
        if (section) {
            whereClause.section = section;
        }
        
        if (search) {
            whereClause.user = {
                ...whereClause.user,
                OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { idNumber: { contains: search, mode: 'insensitive' } }
                ]
            };
        }
        
        const students = await prisma.student.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        idNumber: true,
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                },
                tuitionPayments: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            },
            orderBy: {
                user: { firstName: 'asc' }
            },
            take: 50
        });
        
        const formattedStudents = students.map(student => ({
            id: student.id,
            idNumber: student.user.idNumber,
            firstName: student.user.firstName,
            lastName: student.user.lastName,
            email: student.user.email,
            grade: student.grade,
            section: student.section,
            tuitionStatus: student.tuitionStatus,
            lastPayment: student.tuitionPayments.length > 0 ? student.tuitionPayments[0] : null
        }));
        
        res.json({
            success: true,
            students: formattedStudents,
            total: students.length
        });
        
    } catch (error) {
        console.error('Get students error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch students'
        });
    }
};

// Get Daily Transactions - KEEP AS IS (it's working)
const getDailyTransactions = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        const { date, type } = req.query;
        
        console.log('📊 Getting daily transactions for school:', userSchool);
        
        let whereClause = {};
        
        // Apply school filtering for non-super admins
        if (userSchool && !isSuperAdmin) {
            whereClause.school = userSchool;
        }
        
        if (date) {
            const selectedDate = new Date(date);
            selectedDate.setHours(0, 0, 0, 0);
            const nextDate = new Date(selectedDate);
            nextDate.setDate(nextDate.getDate() + 1);
            
            whereClause.createdAt = {
                gte: selectedDate,
                lt: nextDate
            };
        }
        
        if (type) {
            whereClause.type = type;
        }
        
        console.log('📝 Where clause:', JSON.stringify(whereClause, null, 2));
        
        const transactions = await prisma.dailyTransaction.findMany({
            where: whereClause,
            include: {
                collector: {
                    select: {
                        firstName: true,
                        lastName: true,
                        idNumber: true
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
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });
        
        const summary = await prisma.dailyTransaction.aggregate({
            where: whereClause,
            _sum: { amount: true },
            _count: { id: true }
        });
        
        console.log(`📈 Found ${transactions.length} transactions`);
        
        res.json({
            success: true,
            transactions: transactions,
            summary: {
                totalAmount: summary._sum.amount || 0,
                totalTransactions: summary._count.id
            }
        });
        
    } catch (error) {
        console.error('Get daily transactions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transactions'
        });
    }
};

// View Pending Parent Payments - UPDATED with school filter
const viewPendingPayments = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        // Build school filter
        const schoolFilter = userSchool && !isSuperAdmin 
            ? {
                OR: [
                    { student: { user: { school: userSchool } } },
                    { parent: { user: { school: userSchool } } }
                ]
            }
            : {};
        
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
                                idNumber: true,
                                school: true
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'asc' }
        });
        
        res.render('cashier/pending-payments', {
            title: 'Pending Payments',
            pendingPayments,
            userSchool,
            isSuperAdmin
        });
        
    } catch (error) {
        console.error('View pending payments error:', error);
        res.status(500).render('error/500', { title: 'Server Error' });
    }
};

const getPendingPayments = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        // Build school filter
        const schoolFilter = userSchool && !isSuperAdmin 
            ? {
                OR: [
                    { student: { user: { school: userSchool } } },
                    { parent: { user: { school: userSchool } } }
                ]
            }
            : {};
        
        // Get pending payments
        const pendingPayments = await prisma.parentPayment.findMany({
            where: {
                status: 'pending',
                ...schoolFilter
            },
            include: {
                parent: {
                    include: { user: true }
                },
                student: {
                    include: { user: true }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        
        // Render the page
        res.render('cashier/pending-approve', {
            title: 'Pending Payments for Approval',
            pendingPayments
        });
        
    } catch (error) {
        console.error('Error fetching pending payments:', error);
        req.flash('error', 'Failed to load pending payments');
        res.redirect('/cashier/dashboard');
    }
};

// Approve parent payment (FIXED VERSION)
exports.approveParentPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const cashierId = req.session.user.id;
        
        console.log(`💰 Cashier ${cashierId} approving payment ${id}`);

        // Get payment with parent and wallet
        const payment = await prisma.parentPayment.findUnique({
            where: { id },
            include: {
                parent: {
                    include: {
                        wallet: true,
                        user: true
                    }
                },
                student: {
                    include: {
                        user: true
                    }
                }
            }
        });

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        if (payment.status === 'confirmed') {
            return res.status(400).json({
                success: false,
                message: 'Payment already confirmed'
            });
        }

        // Start transaction
        await prisma.$transaction(async (tx) => {
            // For wallet payments: deduct from wallet NOW (only at approval time)
            if (payment.paymentMethod === 'wallet') {
                // Double-check wallet has enough balance
                if (!payment.parent.wallet || payment.parent.wallet.balance < payment.amount) {
                    throw new Error(`Insufficient wallet balance. Available: =N=${payment.parent.wallet?.balance.toFixed(2) || '0.00'}`);
                }

                // Deduct from wallet (FIRST AND ONLY DEDUCTION)
                await tx.wallet.update({
                    where: { id: payment.parent.wallet.id },
                    data: {
                        balance: {
                            decrement: payment.amount
                        }
                    }
                });

                // Record wallet transaction
                await tx.transaction.create({
                    data: {
                        walletId: payment.parent.wallet.id,
                        amount: -payment.amount, // Negative for deduction
                        type: 'payment',
                        description: `Tuition payment for ${payment.student.user.firstName}`,
                        status: 'completed',
                        referenceId: `payment_${payment.id}`
                    }
                });
            }

            // Update payment status
            await tx.parentPayment.update({
                where: { id },
                data: {
                    status: 'confirmed',
                    confirmedAt: new Date(),
                    confirmedBy: cashierId
                }
            });

            // Update student tuition status
            const totalPaid = await tx.parentPayment.aggregate({
                where: {
                    studentId: payment.studentId,
                    status: 'confirmed'
                },
                _sum: { amount: true }
            });

            const paidAmount = totalPaid._sum.amount || 0;
            
            // Determine tuition status
            let tuitionStatus = 'partial';
            if (paidAmount >= 100000) { // Adjust this threshold as needed
                tuitionStatus = 'paid';
            } else if (paidAmount <= 0) {
                tuitionStatus = 'pending';
            }

            await tx.student.update({
                where: { id: payment.studentId },
                data: { tuitionStatus }
            });

            // Create notification for parent
            await tx.notification.create({
                data: {
                    userId: payment.parent.user.id,
                    title: 'Payment Confirmed',
                    message: `Your payment of =N=${payment.amount.toFixed(2)} for ${payment.student.user.firstName} has been confirmed`,
                    type: 'payment_confirmed',
                    data: JSON.stringify({
                        paymentId: payment.id,
                        amount: payment.amount,
                        studentName: `${payment.student.user.firstName} ${payment.student.user.lastName}`
                    })
                }
            });
        });

        console.log(`✅ Payment ${id} approved successfully`);

        res.json({
            success: true,
            message: 'Payment approved successfully'
        });

    } catch (error) {
        console.error('💥 Approve payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve payment: ' + error.message
        });
    }
};

// View payment details
exports.getPaymentDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const payment = await prisma.parentPayment.findUnique({
            where: { id },
            include: {
                parent: {
                    include: {
                        user: true,
                        wallet: true
                    }
                },
                student: {
                    include: {
                        user: true
                    }
                },
                cashier: {
                    include: {
                        user: true
                    }
                }
            }
        });

        if (!payment) {
            return res.status(404).render('error/404', { title: 'Payment not found' });
        }

        // Calculate parent's current wallet balance
        const walletBalance = payment.parent.wallet?.balance || 0;

        res.render('cashier/payment-details', {
            title: 'Payment Details',
            payment,
            walletBalance,
            user: req.session.user
        });

    } catch (error) {
        console.error('Error getting payment details:', error);
        res.status(500).render('error/500', { title: 'Server Error' });
    }
};

module.exports = {
    dashboard,
    recordFeePayment,
    recordOtherTransaction,
    getStudentsForPayment,
    getDailyTransactions,
    approveParentPayment,
    viewPaymentDetails,
    viewPendingPayments,
    processPayment,
    rejectParentPayment,
    getPendingPayments,
    approveParentPayment 
};