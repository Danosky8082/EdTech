router.get('/api/scan/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await prisma.user.findUnique({
      where: { qrToken: token },
      include: {
        student: { select: { grade: true, section: true, tuitionStatus: true } },
        teacher: { select: { subject: true } },
        parent: { select: { wallet: { select: { balance: true } } } }
      }
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // Build response (safe fields only)
    res.json({
      success: true,
      user: {
        idNumber: user.idNumber,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        phone: user.phone,
        role: user.role,
        school: user.school,
        avatar: user.avatar,
        grade: user.student?.grade,
        section: user.student?.section,
        tuitionStatus: user.student?.tuitionStatus,
        subject: user.teacher?.subject,
        walletBalance: user.parent?.wallet?.balance
      }
    });
  } catch (error) {
    console.error('Scan API error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});