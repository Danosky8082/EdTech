const prisma = require('../config/database');
const { createAssignmentNotification } = require('../services/notificationService');
const { createMaterialNotification } = require('../services/notificationService');

// Create notification for payment
const createPaymentNotification = async (paymentData) => {
    try {
        const { studentId, amount, paymentMethod, receiptNumber, collectedBy } = paymentData;

        // Get student details
        const student = await prisma.student.findUnique({
            where: { userId: parseInt(studentId) },
            include: {
                user: true,
                parents: {
                    include: {
                        parent: {
                            include: {
                                user: true
                            }
                        }
                    }
                }
            }
        });

        if (!student) {
            console.error('Student not found for notification');
            return;
        }

        const parentName = student.parents.length > 0 ? 
            `${student.parents[0].parent.user.firstName} ${student.parents[0].parent.user.lastName}` : 'Unknown Parent';

        const message = `Payment received from ${parentName} for ${student.user.firstName} ${student.user.lastName} - Amount: =N=${amount}`;

        // Get users to notify (cashier, accountant, principal)
        const usersToNotify = await prisma.user.findMany({
            where: {
                OR: [
                    { role: 'admin' },
                    { 
                        admin: {
                            roleLevel: {
                                in: ['principal', 'headteacher', 'administrator']
                            }
                        }
                    }
                ],
                isActive: true
            },
            include: {
                admin: true
            }
        });

        // Create notifications
        const notificationPromises = usersToNotify.map(user => 
            prisma.notification.create({
                data: {
                    userId: user.id,
                    title: 'New Payment Received',
                    message: message,
                    type: 'payment',
                    relatedId: student.userId.toString(),
                    read: false
                }
            })
        );

        await Promise.all(notificationPromises);

        console.log(`Created ${notificationPromises.length} notifications for payment`);

    } catch (error) {
        console.error('Error creating payment notification:', error);
    }
};

// Create notification for wallet deposit
const createWalletDepositNotification = async (depositData) => {
    try {
        const { parentId, amount, paymentMethod } = depositData;

        const parent = await prisma.parent.findUnique({
            where: { id: parentId },
            include: {
                user: true
            }
        });

        if (!parent) {
            console.error('Parent not found for notification');
            return;
        }

        const message = `Wallet deposit from ${parent.user.firstName} ${parent.user.lastName} - Amount: =N=${amount} (${paymentMethod})`;

        // Notify cashier and accountant
        const usersToNotify = await prisma.user.findMany({
            where: {
                OR: [
                    { role: 'admin' },
                    { 
                        admin: {
                            roleLevel: {
                                in: ['principal', 'headteacher', 'administrator']
                            }
                        }
                    }
                ],
                isActive: true
            }
        });

        const notificationPromises = usersToNotify.map(user => 
            prisma.notification.create({
                data: {
                    userId: user.id,
                    title: 'Wallet Deposit',
                    message: message,
                    type: 'wallet',
                    relatedId: parent.userId.toString(),
                    read: false
                }
            })
        );

        await Promise.all(notificationPromises);

    } catch (error) {
        console.error('Error creating wallet deposit notification:', error);
    }
};

// Get unread notifications for user
const getUnreadNotifications = async (userId) => {
    try {
        const notifications = await prisma.notification.findMany({
            where: {
                userId: parseInt(userId),
                read: false
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 10
        });

        return notifications;
    } catch (error) {
        console.error('Error getting notifications:', error);
        return [];
    }
};

// Mark notification as read
const markAsRead = async (notificationId) => {
    try {
        await prisma.notification.update({
            where: { id: parseInt(notificationId) },
            data: { read: true }
        });

        return { success: true };
    } catch (error) {
        console.error('Error marking notification as read:', error);
        return { success: false, error: error.message };
    }
};

// Mark all notifications as read
const markAllAsRead = async (userId) => {
    try {
        await prisma.notification.updateMany({
            where: { 
                userId: parseInt(userId),
                read: false 
            },
            data: { read: true }
        });

        return { success: true };
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        return { success: false, error: error.message };
    }
};

// After creating an assignment:
await createAssignmentNotification({
  assignmentId: newAssignment.id,
  classId: newAssignment.classId,
  title: newAssignment.title,
  dueDate: newAssignment.dueDate,
  teacherId: req.session.user.id,
  teacherName: `${req.session.user.firstName} ${req.session.user.lastName}`
});

// After uploading material:
await createMaterialNotification({
  materialId: newMaterial.id,
  classId: newMaterial.classId,
  title: newMaterial.title,
  description: newMaterial.description,
  teacherId: req.session.user.id,
  teacherName: `${req.session.user.firstName} ${req.session.user.lastName}`,
  materialType: newMaterial.type
});

module.exports = {
    createPaymentNotification,
    createWalletDepositNotification,
    getUnreadNotifications,
    markAsRead,
    markAllAsRead
};