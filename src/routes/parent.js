const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureParent } = require('../config/auth');
const prisma = require('../config/database');

// Parent Dashboard with real data
router.get('/dashboard', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        console.log('👨‍👧‍👦 Loading parent dashboard for user:', req.session.user.id);
        
        // Get parent with students, wallet, savings goals, and pending payments
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        idNumber: true,
                        email: true,
                        avatar: true,
                        school: true // Include parent's school
                    }
                },
                students: {
                    include: {
                        student: {
                            include: {
                                user: {
                                    select: {
                                        firstName: true,
                                        lastName: true,
                                        idNumber: true,
                                        email: true,
                                        avatar: true,
                                        school: true // Include student's school
                                    }
                                },
                                tuitionPayments: {
                                    orderBy: {
                                        createdAt: 'desc'
                                    },
                                    take: 5
                                }
                                
                            }
                        }
                    }
                },
                wallet: true,
                savingsGoals: {
                    where: {
                        isActive: true
                    },
                    include: {
                        deposits: {
                            orderBy: {
                                createdAt: 'desc'
                            },
                            take: 5
                        }
                    }
                },
                payments: {
                    where: {
                        status: 'pending'
                    },
                    include: {
                        student: {
                            include: {
                                user: true
                            }
                        }
                    }
                }
            }
        });

        if (!parent) {
            console.log('❌ Parent not found for user:', req.session.user.id);
            req.session.error_msg = 'Parent profile not found';
            return res.redirect('/');
        }

        // Group students by school for better organization
        const studentsBySchool = {};
        const allStudents = [];
        
        parent.students.forEach(studentRel => {
            const student = studentRel.student;
            const school = student.user.school || 'Unknown School';
            
            // Add to school grouping
            if (!studentsBySchool[school]) {
                studentsBySchool[school] = [];
            }
            
            // Mock progress calculation
            const progress = {
                overall: Math.floor(Math.random() * 100),
                subjects: [
                    { name: 'Mathematics', progress: Math.floor(Math.random() * 100) },
                    { name: 'Science', progress: Math.floor(Math.random() * 100) },
                    { name: 'English', progress: Math.floor(Math.random() * 100) }
                ],
                lastActive: new Date(Date.now() - Math.floor(Math.random() * 7) * 24 * 60 * 60 * 1000)
            };
            
            const studentData = {
                ...studentRel,
                student: student,
                progress: progress,
                school: school
            };
            
            studentsBySchool[school].push(studentData);
            allStudents.push(studentData);
        });

        // Calculate total savings
        const totalSavings = parent.savingsGoals.reduce((total, goal) => total + goal.currentAmount, 0);

        res.render('parent/dashboard', {
            title: 'Parent Dashboard',
            parent: parent,
            user: req.session.user,
            students: allStudents,
            studentsBySchool: studentsBySchool,
            wallet: parent.wallet,
            savingsGoals: parent.savingsGoals,
            totalSavings: totalSavings,
            pendingPayments: parent.payments,
            error_msg: req.session.error_msg,
            success_msg: req.session.success_msg
        });

        // Clear session messages after displaying
        delete req.session.error_msg;
        delete req.session.success_msg;

    } catch (error) {
        console.error('💥 Parent dashboard error:', error);
        req.session.error_msg = 'Error loading dashboard: ' + error.message;
        res.redirect('/');
    }
});

// View Student Details
// View Student Details - UPDATED to include parentPayments
router.get('/student/:studentId', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { studentId } = req.params;
        
        // Verify the student belongs to this parent
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                students: {
                    where: {
                        studentId: studentId
                    }
                }
            }
        });

        if (!parent || parent.students.length === 0) {
            return res.status(403).json({ 
                success: false, 
                message: 'Student not linked to your account' 
            });
        }

        // Get student details with ALL payments (parentPayments AND tuitionPayments)
        const student = await prisma.student.findUnique({
            where: { id: studentId },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        idNumber: true,
                        email: true,
                        avatar: true,
                        dateOfBirth: true,
                        phone: true,
                        school: true
                    }
                },
                // Parent payments (payments made by this parent)
                parentPayments: {
                    where: {
                        parentId: parent.id // Only get payments made by this parent
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    include: {
                        cashier: {
                            select: {
                                firstName: true,
                                lastName: true
                            }
                        }
                    }
                },
                // Official tuition payments (from school records)
                tuitionPayments: {
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            }
        });

        res.json({ 
            success: true, 
            student: student 
        });

    } catch (error) {
        console.error('Error fetching student details:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Parent Payment Route (Updated)
router.post('/payment', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { studentId, amount, paymentMethod, feeType = 'tuition', description } = req.body;
        
        console.log('💳 Parent payment attempt:', { studentId, amount, paymentMethod, feeType });

        // Verify the student belongs to this parent
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                students: {
                    where: { studentId: studentId }
                },
                wallet: true
            }
        });

        if (!parent || parent.students.length === 0) {
            return res.status(403).json({ 
                success: false, 
                message: 'Student not linked to your account' 
            });
        }

        // For wallet payments, check balance
        if (paymentMethod === 'wallet') {
            if (!parent.wallet || parent.wallet.balance < parseFloat(amount)) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient wallet balance. Available: =N=${parent.wallet?.balance.toFixed(2) || '0.00'}`
                });
            }
        }

        // Generate receipt number with fee type prefix
        const receiptNumber = `${feeType.toUpperCase().substr(0, 3)}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

        // Create payment record
        const payment = await prisma.parentPayment.create({
            data: {
                parentId: parent.id,
                studentId: studentId,
                amount: parseFloat(amount),
                feeType: feeType,
                paymentMethod: paymentMethod,
                description: description || `${feeType} fee payment`,
                status: 'pending',
                receiptNumber: receiptNumber
            }
        });

        console.log('✅ Payment created:', { 
            id: payment.id, 
            receiptNumber, 
            amount, 
            feeType 
        });

        res.json({ 
            success: true, 
            message: 'Payment submitted for cashier confirmation',
            paymentId: payment.id,
            receiptNumber: receiptNumber,
            feeType: feeType
        });

    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Payment processing failed: ' + error.message 
        });
    }
});

// Add Funds to Wallet 
router.post('/wallet/add-funds', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { amount, paymentMethod } = req.body;
        
        console.log('💰 Adding funds to wallet:', { amount, paymentMethod });

        // Validate input
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount. Please enter a positive number.'
            });
        }

        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: { wallet: true }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: 'Parent not found'
            });
        }

        // If wallet doesn't exist, create one
        let wallet = parent.wallet;
        if (!wallet) {
            console.log('💳 Creating new wallet for parent');
            wallet = await prisma.wallet.create({
                data: {
                    parentId: parent.id,
                    balance: 0
                }
            });
        }

        const parsedAmount = parseFloat(amount);
        
        // Simulate adding funds (in a real app, this would integrate with a payment gateway)
        // For now, we'll just add the amount directly
        await prisma.$transaction(async (tx) => {
            // Update wallet balance
            await tx.wallet.update({
                where: { id: wallet.id },
                data: {
                    balance: {
                        increment: parsedAmount
                    }
                }
            });

            // Record transaction
            await tx.transaction.create({
                data: {
                    walletId: wallet.id,
                    amount: parsedAmount,
                    type: 'deposit',
                    description: `Added funds via ${paymentMethod}`,
                    status: 'completed',
                    referenceId: `deposit_${Date.now()}`
                }
            });
        });

        // Get updated wallet balance
        const updatedWallet = await prisma.wallet.findUnique({
            where: { id: wallet.id }
        });

        console.log('✅ Funds added successfully. New balance:', updatedWallet.balance);

        res.json({
            success: true,
            message: `=N=${parsedAmount.toFixed(2)} added to wallet successfully`,
            balance: updatedWallet.balance
        });

    } catch (error) {
        console.error('💥 Add funds error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add funds to wallet: ' + error.message
        });
    }
});


// Savings Goals Management
router.post('/savings/goals', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { name, targetAmount, targetDate } = req.body;

        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: 'Parent not found'
            });
        }

        const goal = await prisma.savingsGoal.create({
            data: {
                parentId: parent.id,
                name: name,
                targetAmount: parseFloat(targetAmount),
                targetDate: targetDate ? new Date(targetDate) : null,
                currentAmount: 0
            }
        });

        res.json({
            success: true,
            message: 'Savings goal created successfully',
            goal: goal
        });

    } catch (error) {
        console.error('Create savings goal error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create savings goal'
        });
    }
});

// Add to Savings
// Add to Savings - ENHANCED DEBUGGING
router.post('/savings/deposit', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        console.log('💰 Savings deposit request received:', req.body);
        console.log('👤 Parent ID from session:', req.session.user.parentId);

        const { goalId, amount, description } = req.body;

        // Enhanced validation
        if (!goalId) {
            console.log('❌ Missing goalId');
            return res.status(400).json({
                success: false,
                message: 'Savings goal ID is required'
            });
        }

        if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
            console.log('❌ Invalid amount:', amount);
            return res.status(400).json({
                success: false,
                message: 'Valid positive amount is required'
            });
        }

        const parsedAmount = parseFloat(amount);
        const parsedGoalId = String(goalId); // Ensure it's a string for Prisma

        console.log('🔍 Parsed data:', { parsedGoalId, parsedAmount });

        // Check if parent exists
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                wallet: true,
                savingsGoals: {
                    where: { 
                        id: parsedGoalId,
                        isActive: true 
                    }
                }
            }
        });

        console.log('👨‍👧‍👦 Parent found:', !!parent);
        console.log('💳 Wallet exists:', !!parent?.wallet);
        console.log('🎯 Savings goals found:', parent?.savingsGoals?.length);

        if (!parent) {
            console.log('❌ Parent not found');
            return res.status(404).json({
                success: false,
                message: 'Parent not found'
            });
        }

        if (!parent.wallet) {
            console.log('❌ Wallet not found');
            return res.status(404).json({
                success: false,
                message: 'Wallet not found. Please contact support.'
            });
        }

        if (parent.savingsGoals.length === 0) {
            console.log('❌ No matching savings goal found');
            return res.status(404).json({
                success: false,
                message: 'Savings goal not found or not active'
            });
        }

        // Check wallet balance
        if (parent.wallet.balance < parsedAmount) {
            console.log('❌ Insufficient balance:', {
                balance: parent.wallet.balance,
                requested: parsedAmount
            });
            return res.status(400).json({
                success: false,
                message: `Insufficient wallet balance. Available: =N=${parent.wallet.balance.toFixed(2)}, Requested: =N=${parsedAmount.toFixed(2)}`
            });
        }

        // Start transaction
        await prisma.$transaction(async (tx) => {
            // Deduct from wallet
            await tx.wallet.update({
                where: { id: parent.wallet.id },
                data: {
                    balance: {
                        decrement: parsedAmount
                    }
                }
            });

            // Add to savings goal
            await tx.savingsGoal.update({
                where: { id: parsedGoalId },
                data: {
                    currentAmount: {
                        increment: parsedAmount
                    }
                }
            });

            // Create savings deposit
            await tx.savingsDeposit.create({
                data: {
                    savingsGoalId: parsedGoalId,
                    amount: parsedAmount,
                    description: description || 'Savings deposit',
                    status: 'completed'
                }
            });

            // Record wallet transaction
            await tx.transaction.create({
                data: {
                    walletId: parent.wallet.id,
                    amount: -parsedAmount,
                    type: 'savings_deposit',
                    description: description || 'Transfer to savings',
                    status: 'completed'
                }
            });
        });

        console.log('✅ Savings deposit successful');
        res.json({
            success: true,
            message: `=N=${parsedAmount.toFixed(2)} added to savings successfully`
        });

    } catch (error) {
        console.error('💥 Add to savings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add to savings: ' + error.message
        });
    }
});

// Transfer Savings to Wallet - ENHANCED DEBUGGING
router.post('/savings/transfer-to-wallet', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        console.log('🔄 Transfer to wallet request received:', req.body);
        console.log('👤 Parent ID from session:', req.session.user.parentId);

        const { goalId } = req.body;

        // Enhanced validation
        if (!goalId) {
            console.log('❌ Missing goalId');
            return res.status(400).json({
                success: false,
                message: 'Savings goal ID is required'
            });
        }

        const parsedGoalId = String(goalId); // Ensure it's a string for Prisma

        // Check if parent exists
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                wallet: true,
                savingsGoals: {
                    where: { 
                        id: parsedGoalId,
                        isActive: true 
                    }
                }
            }
        });

        console.log('👨‍👧‍👦 Parent found:', !!parent);
        console.log('💳 Wallet exists:', !!parent?.wallet);
        console.log('🎯 Savings goals found:', parent?.savingsGoals?.length);

        if (!parent) {
            console.log('❌ Parent not found');
            return res.status(404).json({
                success: false,
                message: 'Parent not found'
            });
        }

        if (!parent.wallet) {
            console.log('❌ Wallet not found');
            return res.status(404).json({
                success: false,
                message: 'Wallet not found. Please contact support.'
            });
        }

        if (parent.savingsGoals.length === 0) {
            console.log('❌ No matching savings goal found');
            return res.status(404).json({
                success: false,
                message: 'Savings goal not found or not active'
            });
        }

        const goal = parent.savingsGoals[0];
        console.log('🎯 Goal details:', {
            name: goal.name,
            currentAmount: goal.currentAmount,
            isActive: goal.isActive
        });

        if (goal.currentAmount <= 0) {
            console.log('❌ No savings to transfer');
            return res.status(400).json({
                success: false,
                message: 'No savings to transfer'
            });
        }

        const transferAmount = goal.currentAmount;

        // Start transaction
        await prisma.$transaction(async (tx) => {
            // Add to wallet
            await tx.wallet.update({
                where: { id: parent.wallet.id },
                data: {
                    balance: {
                        increment: transferAmount
                    }
                }
            });

            // Reset savings goal and mark as completed
            await tx.savingsGoal.update({
                where: { id: parsedGoalId },
                data: {
                    currentAmount: 0,
                    isActive: false,
                    //completedAt: new Date()
                }
            });

            // Record wallet transaction
            await tx.transaction.create({
                data: {
                    walletId: parent.wallet.id,
                    amount: transferAmount,
                    type: 'savings_transfer',
                    description: `Transfer from savings: ${goal.name}`,
                    status: 'completed'
                }
            });

            // Create a savings deposit record for the transfer
            await tx.savingsDeposit.create({
                data: {
                    savingsGoalId: parsedGoalId,
                    amount: -transferAmount, // Negative amount for withdrawal
                    description: `Transferred to wallet`,
                    status: 'completed'
                }
            });
        });

        console.log('✅ Transfer to wallet successful');
        res.json({
            success: true,
            message: `=N=${transferAmount.toFixed(2)} transferred to wallet successfully`
        });

    } catch (error) {
        console.error('💥 Transfer savings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to transfer savings to wallet: ' + error.message
        });
    }
});

// Parent transaction history
router.get('/transactions', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                wallet: {
                    include: {
                        transactions: {
                            orderBy: { createdAt: 'desc' },
                            take: 20
                        }
                    }
                }
            }
        });

        if (!parent || !parent.wallet) {
            return res.json({ success: true, transactions: [] });
        }

        res.json({ 
            success: true, 
            transactions: parent.wallet.transactions 
        });
    } catch (error) {
        console.error('Error getting parent transactions:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Recent Activity
router.get('/recent-activity', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                wallet: {
                    include: {
                        transactions: {
                            orderBy: { createdAt: 'desc' },
                            take: 10
                        }
                    }
                },
                savingsGoals: {
                    include: {
                        deposits: {
                            orderBy: { createdAt: 'desc' },
                            take: 5
                        }
                    }
                },
                payments: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    include: {
                        student: {
                            include: {
                                user: true
                            }
                        }
                    }
                }
            }
        });

        if (!parent) {
            return res.json({ success: true, activities: [] });
        }

        // Combine activities from different sources
        const activities = [];

        // Wallet transactions
        if (parent.wallet) {
            parent.wallet.transactions.forEach(transaction => {
                activities.push({
                    title: 'Wallet Transaction',
                    description: transaction.description,
                    type: `Wallet ${transaction.type}`,
                    timestamp: transaction.createdAt
                });
            });
        }

        // Savings activities
        parent.savingsGoals.forEach(goal => {
            goal.deposits.forEach(deposit => {
                activities.push({
                    title: 'Savings Deposit',
                    description: `Added =N=${deposit.amount.toFixed(2)} to ${goal.name}`,
                    type: 'Savings',
                    timestamp: deposit.createdAt
                });
            });
        });

        // Payment activities
        parent.payments.forEach(payment => {
            activities.push({
                title: 'Payment',
                description: `Payment of =N=${payment.amount.toFixed(2)} for ${payment.student.user.firstName}`,
                type: `Payment - ${payment.status}`,
                timestamp: payment.createdAt
            });
        });

        // Sort by timestamp and take latest 10
        activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const recentActivities = activities.slice(0, 10);

        res.json({ 
            success: true, 
            activities: recentActivities 
        });
    } catch (error) {
        console.error('Error getting recent activity:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Contact School
router.post('/contact-school', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { subject, message, studentId } = req.body;

        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                user: true
            }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: 'Parent not found'
            });
        }

        // In a real application, you would send an email or create a ticket
        console.log('📧 Contact message from parent:', {
            parent: `${parent.user.firstName} ${parent.user.lastName}`,
            subject,
            message,
            studentId
        });

        res.json({
            success: true,
            message: 'Your message has been sent to the school administration. We will get back to you soon.'
        });

    } catch (error) {
        console.error('Contact school error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send message'
        });
    }
});

// Get specific savings goal
router.get('/savings/goal/:id', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { id } = req.params;

        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                savingsGoals: {
                    where: { 
                        id: id,
                        isActive: true 
                    },
                    include: {
                        deposits: {
                            orderBy: {
                                createdAt: 'desc'
                            }
                        }
                    }
                }
            }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: 'Parent not found'
            });
        }

        if (parent.savingsGoals.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Savings goal not found or not active'
            });
        }

        const goal = parent.savingsGoals[0];
        
        // Calculate progress
        const progress = goal.targetAmount > 0 
            ? (goal.currentAmount / goal.targetAmount) * 100 
            : 0;

        res.json({
            success: true,
            goal: {
                ...goal,
                progress: progress.toFixed(1),
                remainingAmount: goal.targetAmount - goal.currentAmount
            }
        });

    } catch (error) {
        console.error('Error getting savings goal:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Get specific savings goal details
router.get('/savings/goal/:id', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { id } = req.params;

        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                savingsGoals: {
                    where: { 
                        id: id,
                        isActive: true 
                    },
                    include: {
                        deposits: {
                            orderBy: {
                                createdAt: 'desc'
                            }
                        }
                    }
                }
            }
        });

        if (!parent) {
            return res.status(404).json({
                success: false,
                message: 'Parent not found'
            });
        }

        if (parent.savingsGoals.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Savings goal not found or not active'
            });
        }

        const goal = parent.savingsGoals[0];
        
        // Calculate progress percentage
        const progress = goal.targetAmount > 0 
            ? (goal.currentAmount / goal.targetAmount) * 100 
            : 0;
        
        const response = {
            ...goal,
            progress: progress.toFixed(1),
            remainingAmount: goal.targetAmount - goal.currentAmount,
            isCompleted: goal.currentAmount >= goal.targetAmount
        };

        res.json({
            success: true,
            goal: response
        });

    } catch (error) {
        console.error('Error getting savings goal:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// View pending payments
router.get('/pending-payments', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                payments: {
                    where: {
                        status: 'pending'
                    },
                    include: {
                        student: {
                            include: {
                                user: {
                                    select: {
                                        firstName: true,
                                        lastName: true,
                                        idNumber: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            }
        });

        res.json({
            success: true,
            payments: parent?.payments || []
        });

    } catch (error) {
        console.error('Error fetching pending payments:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// View confirmed payments
router.get('/confirmed-payments', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId }
        });

        if (!parent) {
            return res.json({
                success: true,
                payments: [],
                pagination: {
                    page: 1,
                    limit: parseInt(limit),
                    total: 0,
                    pages: 0
                }
            });
        }

        const [payments, total] = await Promise.all([
            prisma.parentPayment.findMany({
                where: {
                    parentId: parent.id,
                    status: 'confirmed'
                },
                include: {
                    student: {
                        include: {
                            user: {
                                select: {
                                    firstName: true,
                                    lastName: true,
                                    idNumber: true
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
                    confirmedAt: 'desc'
                },
                skip: skip,
                take: parseInt(limit)
            }),
            prisma.parentPayment.count({
                where: {
                    parentId: parent.id,
                    status: 'confirmed'
                }
            })
        ]);

        res.json({
            success: true,
            payments: payments,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });

    } catch (error) {
        console.error('Error fetching confirmed payments:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Enhanced payment processing with cashier workflow
router.post('/payment', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { studentId, amount, paymentMethod, description } = req.body;
        
        console.log('💳 Parent payment attempt:', { studentId, amount, paymentMethod });

        // Verify the student belongs to this parent
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                students: {
                    where: { studentId: studentId }
                },
                wallet: true
            }
        });

        if (!parent || parent.students.length === 0) {
            return res.status(403).json({ 
                success: false, 
                message: 'Student not linked to your account' 
            });
        }

        // For wallet payments, check balance but DON'T deduct yet
        if (paymentMethod === 'wallet') {
            if (!parent.wallet || parent.wallet.balance < parseFloat(amount)) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient wallet balance. Available: =N=${parent.wallet?.balance.toFixed(2) || '0.00'}`
                });
            }
            
            // Reserve the amount but don't deduct yet
            // Create a temporary hold on the wallet
            await prisma.wallet.update({
                where: { id: parent.wallet.id },
                data: {
                    balance: {
                        decrement: parseFloat(amount)
                    }
                }
            });
            
            // Record pending transaction
            await prisma.transaction.create({
                data: {
                    walletId: parent.wallet.id,
                    amount: -parseFloat(amount),
                    type: 'payment_hold',
                    description: `Payment hold for ${description || 'student fees'}`,
                    status: 'pending',
                    referenceId: `hold_${Date.now()}`
                }
            });
        }

        // Generate receipt number
        const receiptNumber = `PAY-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

        // Create payment record (pending cashier confirmation)
        const payment = await prisma.parentPayment.create({
            data: {
                parentId: parent.id,
                studentId: studentId,
                amount: parseFloat(amount),
                paymentMethod: paymentMethod,
                description: description || 'Tuition Fee Payment',
                status: 'pending',
                receiptNumber: receiptNumber,
                // Track the wallet deduction status
                walletDeducted: paymentMethod === 'wallet'
            }
        });

        res.json({ 
            success: true, 
            message: 'Payment submitted for cashier confirmation',
            paymentId: payment.id,
            receiptNumber: receiptNumber
        });

    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Payment processing failed: ' + error.message 
        });
    }
});

// Check payment status
router.get('/payment/:paymentId/status', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { paymentId } = req.params;

        const payment = await prisma.parentPayment.findUnique({
            where: { id: paymentId },
            include: {
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
            }
        });

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        // Verify parent owns this payment
        if (payment.parentId !== req.session.user.parentId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        res.json({
            success: true,
            payment: payment
        });

    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// View Progress Reports
router.get('/progress-reports', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        console.log('📊 Loading progress reports for parent:', req.session.user.id);
        
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        idNumber: true,
                        email: true
                    }
                },
                students: {
                    include: {
                        student: {
                            include: {
                                user: {
                                    select: {
                                        firstName: true,
                                        lastName: true,
                                        idNumber: true,
                                        email: true,
                                        school: true
                                    }
                                },
                                // Get student's academic data
                                classWorkSubmissions: {
                                    include: {
                                        classWork: true
                                    },
                                    orderBy: {
                                        submittedAt: 'desc'
                                    },
                                    take: 10
                                },
                                examAttempts: {
                                    include: {
                                        exam: true
                                    },
                                    orderBy: {
                                        submittedAt: 'desc'
                                    },
                                    take: 10
                                },
                                submissions: {
                                    include: {
                                        assignment: true
                                    },
                                    orderBy: {
                                        submittedAt: 'desc'
                                    },
                                    take: 10
                                },
                                enrollments: {
                                    include: {
                                        class: {
                                            include: {
                                                teacher: {
                                                    include: {
                                                        user: true
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!parent) {
            req.session.error_msg = 'Parent profile not found';
            return res.redirect('/parent/dashboard');
        }

        // Process student data for progress reports
        const studentsWithProgress = await Promise.all(parent.students.map(async (studentRel) => {
            const student = studentRel.student;
            
            // Calculate overall progress based on submissions
            const totalSubmissions = student.submissions.length;
            const gradedSubmissions = student.submissions.filter(s => s.grade !== null).length;
            const submissionProgress = totalSubmissions > 0 ? (gradedSubmissions / totalSubmissions) * 100 : 0;
            
            // Calculate average grade
            const grades = student.submissions.filter(s => s.grade !== null).map(s => s.grade);
            const averageGrade = grades.length > 0 
                ? grades.reduce((sum, grade) => sum + grade, 0) / grades.length 
                : 0;
            
            // Get class work scores
            const classWorkScores = student.classWorkSubmissions
                .filter(cw => cw.score !== null)
                .map(cw => ({
                    title: cw.classWork.title,
                    score: cw.score,
                    type: cw.classWork.type,
                    date: cw.submittedAt
                }));
            
            // Get exam scores
            const examScores = student.examAttempts
                .filter(exam => exam.score !== null)
                .map(exam => ({
                    title: exam.exam.title,
                    score: exam.score,
                    date: exam.submittedAt
                }));
            
            // Get assignment submissions
            const assignmentScores = student.submissions
                .filter(sub => sub.grade !== null)
                .map(sub => ({
                    title: sub.assignment.title,
                    grade: sub.grade,
                    feedback: sub.feedback,
                    date: sub.submittedAt
                }));
            
            // Calculate attendance (mock data for now)
            const attendance = {
                present: Math.floor(Math.random() * 90) + 10,
                absent: Math.floor(Math.random() * 10),
                late: Math.floor(Math.random() * 5)
            };
            const attendanceRate = (attendance.present / (attendance.present + attendance.absent)) * 100;
            
            // Get class enrollment info
            const classes = student.enrollments.map(enrollment => ({
                name: enrollment.class.name,
                grade: enrollment.class.grade,
                section: enrollment.class.section,
                teacher: enrollment.class.teacher?.user
            }));
            
            return {
                ...studentRel,
                student: student,
                progress: {
                    overall: Math.min(submissionProgress, 100),
                    submissionRate: submissionProgress,
                    averageGrade: averageGrade.toFixed(1),
                    attendance: {
                        ...attendance,
                        rate: attendanceRate.toFixed(1)
                    },
                    classWork: classWorkScores,
                    exams: examScores,
                    assignments: assignmentScores,
                    classes: classes,
                    lastActive: student.submissions.length > 0 
                        ? student.submissions[0].submittedAt 
                        : new Date()
                }
            };
        }));

        res.render('parent/progress-reports', {
            title: 'Student Progress Reports',
            parent: parent,
            students: studentsWithProgress,
            error_msg: req.session.error_msg,
            success_msg: req.session.success_msg
        });

        // Clear session messages after displaying
        delete req.session.error_msg;
        delete req.session.success_msg;

    } catch (error) {
        console.error('💥 Progress reports error:', error);
        req.session.error_msg = 'Error loading progress reports: ' + error.message;
        res.redirect('/parent/dashboard');
    }
});

// Download Progress Report as PDF
router.get('/progress-reports/:studentId/pdf', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const { studentId } = req.params;
        
        // Verify the student belongs to this parent
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                students: {
                    where: {
                        studentId: studentId
                    }
                }
            }
        });

        if (!parent || parent.students.length === 0) {
            return res.status(403).json({ 
                success: false, 
                message: 'Student not linked to your account' 
            });
        }

        // In a real application, you would generate a PDF here
        // For now, return a message
        res.json({
            success: true,
            message: 'PDF generation would be implemented here',
            studentId: studentId
        });

    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating PDF report'
        });
    }
});

// In your parent route file
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    const parent = await prisma.parent.findFirst({
      where: { userId },
      include: {
        user: true,
        wallet: {
          include: {
            transactions: {
              orderBy: {
                createdAt: 'desc'
              },
              take: 10
            }
          }
        },
        students: {
          include: {
            student: {
              include: {
                user: true,
                tuitionPayments: {
                  orderBy: { createdAt: 'desc' },
                  take: 5
                }
              }
            }
          }
        }
      }
    });
    
    if (!parent) {
      return res.status(404).render('error/404', { title: 'Parent not found' });
    }
    
    // Ensure wallet exists
    let wallet = parent.wallet;
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          parentId: parent.id,
          balance: 0
        }
      });
    }
    
    // Verify balance
    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id }
    });
    
    const calculatedBalance = transactions.reduce((total, t) => {
      if (t.type === 'deposit' || t.type === 'refund' || t.type === 'savings_transfer') {
        return total + t.amount;
      } else if (t.type === 'payment' || t.type === 'withdrawal' || t.type === 'savings_deposit') {
        return total - t.amount;
      }
      return total;
    }, 0);
    
    // Fix if discrepancy
    if (Math.abs(wallet.balance - calculatedBalance) > 0.01) {
      wallet = await prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: calculatedBalance }
      });
    }
    
    // Rest of your dashboard logic...
    
    res.render('parent/dashboard', {
      title: 'Parent Dashboard',
      user: req.session.user,
      wallet: wallet,
      // ... other data
    });
    
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
});

// Debug: Verify wallet balance
router.get('/wallet/verify', ensureAuthenticated, ensureParent, async (req, res) => {
    try {
        const parent = await prisma.parent.findUnique({
            where: { id: req.session.user.parentId },
            include: {
                wallet: {
                    include: {
                        transactions: {
                            orderBy: { createdAt: 'desc' }
                        }
                    }
                },
                payments: {
                    where: { status: 'pending' }
                }
            }
        });

        if (!parent || !parent.wallet) {
            return res.json({
                success: false,
                message: 'Wallet not found'
            });
        }

        // Calculate balance from transactions
        const calculatedBalance = parent.wallet.transactions.reduce((total, t) => {
            if (t.type.includes('deposit') || t.type === 'savings_transfer') {
                return total + t.amount;
            } else if (t.type.includes('payment') || t.type === 'savings_deposit') {
                return total + t.amount; // t.amount is negative for payments
            }
            return total;
        }, 0);

        const discrepancy = Math.abs(parent.wallet.balance - calculatedBalance);

        res.json({
            success: true,
            walletBalance: parent.wallet.balance,
            calculatedBalance: calculatedBalance,
            discrepancy: discrepancy,
            isCorrect: discrepancy < 0.01,
            pendingPayments: parent.payments.length,
            transactions: parent.wallet.transactions.slice(0, 10)
        });

    } catch (error) {
        console.error('Wallet verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Verification failed: ' + error.message
        });
    }
});

module.exports = router;