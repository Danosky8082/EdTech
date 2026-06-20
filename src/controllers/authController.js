const prisma = require('../config/database');
const { hashPassword, comparePassword } = require('../utils/passwordUtils');

// Display login page
const showLogin = (req, res) => {
  res.render('auth/login', { 
    title: 'Login', 
    hideNavbar: true,
    error: null,
    success: null
  });
};

// Enhanced login with explicit session save and role‑based redirects
const login = async (req, res) => {
  const { idNumber, password } = req.body;

  try {
    // Find user by ID number
    const user = await prisma.user.findUnique({
      where: { idNumber: idNumber.trim() },
      include: {
        student: true,
        teacher: true,
        admin: true,
        parent: true,
        cashier: true,
        accountant: true
      }
    });

    if (!user) {
      return res.render('auth/login', { 
        title: 'Login',
        hideNavbar: true,
        error: 'Invalid ID number or password',
        success: null
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.render('auth/login', { 
        title: 'Login',
        hideNavbar: true,
        error: 'Account is deactivated. Please contact administrator.',
        success: null
      });
    }

    // Verify password
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res.render('auth/login', { 
        title: 'Login',
        hideNavbar: true,
        error: 'Invalid ID number or password',
        success: null
      });
    }

    // --- Build session user object ---
    const sessionUser = {
      id: user.id,
      idNumber: user.idNumber,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      avatar: user.avatar,
      school: user.school
    };

    // Add role‑specific IDs
    if (user.role === 'student' && user.student) {
      sessionUser.studentId = user.student.id;
    } else if (user.role === 'teacher' && user.teacher) {
      sessionUser.teacherId = user.teacher.id;
    } else if (user.role === 'admin' && user.admin) {
      sessionUser.adminId = user.admin.id;
    } else if (user.role === 'parent' && user.parent) {
      sessionUser.parentId = user.parent.id;
    } else if (user.role === 'cashier' && user.cashier) {
      sessionUser.cashierId = user.cashier.id;
    } else if (user.role === 'accountant' && user.accountant) {
      sessionUser.accountantId = user.accountant.id;
    }

    // Set session user
    req.session.user = sessionUser;

    // --- Explicitly save session before redirecting ---
    req.session.save((err) => {
      if (err) {
        console.error('❌ Session save error:', err);
        return res.render('auth/login', {
          title: 'Login',
          hideNavbar: true,
          error: 'Session error. Please try again.',
          success: null
        });
      }

      // Role‑based redirect
      const role = user.role;
      let redirectPath = '/';
      switch (role) {
        case 'parent':    redirectPath = '/parent/dashboard'; break;
        case 'student':   redirectPath = '/student/dashboard'; break;
        case 'teacher':   redirectPath = '/teacher/dashboard'; break;
        case 'admin':     redirectPath = '/admin/dashboard'; break;
        case 'cashier':   redirectPath = '/cashier/dashboard'; break;
        case 'accountant': redirectPath = '/accountant/dashboard'; break;
        default:          redirectPath = '/';
      }
      // ✅ IMPORTANT: return to prevent any further code execution
      return res.redirect(redirectPath);
    });

  } catch (error) {
    console.error('💥 Login error:', error);
    // ✅ Added return here
    return res.render('auth/login', { 
      title: 'Login',
      hideNavbar: true,
      error: 'An error occurred during login. Please try again.',
      success: null
    });
  }
};

// Display change password page
const showChangePassword = (req, res) => {
  res.render('auth/change-password', { 
    title: 'Change Password',
    error: null, 
    success: null 
  });
};

// Handle password change
const changePassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const userId = req.session.user.id;

  try {
    if (newPassword !== confirmPassword) {
      return res.render('auth/change-password', {
        title: 'Change Password',
        error: 'New passwords do not match',
        success: null
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.render('auth/change-password', {
        title: 'Change Password',
        error: 'User not found',
        success: null
      });
    }

    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      return res.render('auth/change-password', {
        title: 'Change Password',
        error: 'Current password is incorrect',
        success: null
      });
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { 
        password: hashedPassword,
        isTemporaryPassword: false,
        passwordChangedAt: new Date()
      }
    });

    return res.render('auth/change-password', {
      title: 'Change Password',
      error: null,
      success: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Password change error:', error);
    return res.render('auth/change-password', {
      title: 'Change Password',
      error: 'An error occurred while changing password',
      success: null
    });
  }
};

// Logout
const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/auth/login');
  });
};

module.exports = {
  showLogin,
  login,
  showChangePassword,
  changePassword,
  logout
};