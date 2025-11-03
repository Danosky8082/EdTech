const checkPasswordChange = async (req, res, next) => {
  if (req.session.user.role === 'student') {
    const student = await prisma.student.findUnique({
      where: { userId: req.session.user.id },
      select: { canChangePassword: true, tuitionStatus: true }
    });

    if (!student.canChangePassword) {
      req.session.error = 'You cannot change your password until tuition is fully paid.';
      return res.redirect('/student/dashboard');
    }
  }
  next();
};

module.exports = { checkPasswordChange };