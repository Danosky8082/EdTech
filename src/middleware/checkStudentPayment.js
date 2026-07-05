const prisma = require('../config/database');

/**
 * Middleware to restrict unpaid students from accessing protected pages.
 * Redirects to student dashboard with a flash message.
 */
const checkStudentPayment = async (req, res, next) => {
    // Only apply to student role
    if (req.session.user.role !== 'student') {
        return next();
    }

    const userId = req.session.user.id;

    try {
        const student = await prisma.student.findUnique({
            where: { userId: userId },
            select: { tuitionStatus: true }
        });

        if (student && student.tuitionStatus === 'unpaid') {
            req.flash('error', 'Please complete your tuition payment to access this feature.');
            return res.redirect('/student/dashboard');
        }

        next();
    } catch (error) {
        console.error('Error checking student payment status:', error);
        // On error, allow access (or redirect to dashboard – your choice)
        // We'll allow access and log the error
        next();
    }
};

module.exports = checkStudentPayment;