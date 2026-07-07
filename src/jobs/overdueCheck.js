const cron = require('node-cron');
const prisma = require('../config/database');

// Run every day at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('🔄 Running overdue book check...');
  try {
    const now = new Date();
    // Find all library transactions that are borrowed, not returned, and dueDate < now
    const overdueTransactions = await prisma.libraryTransaction.findMany({
      where: {
        action: 'borrow',
        returnedAt: null,
        dueDate: { lt: now }
      },
      include: {
        student: { include: { user: true } },
        book: true
      }
    });

    console.log(`📚 Found ${overdueTransactions.length} overdue books.`);

    for (const transaction of overdueTransactions) {
      // Create notification for the student
      await prisma.notification.create({
        data: {
          userId: transaction.student.userId,
          title: '📚 Overdue Book',
          message: `Your borrowed book "${transaction.book.title}" is overdue. Please return it as soon as possible.`,
          icon: 'fa-book',
          read: false,
          createdAt: new Date()
        }
      });

      // Optionally, send an email notification (if you have email integration)
      // await sendEmail(transaction.student.user.email, 'Overdue Book', ...);
    }

    console.log('✅ Overdue notifications sent.');
  } catch (error) {
    console.error('❌ Overdue check failed:', error);
  }
});