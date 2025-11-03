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

// Enhanced login with better debugging
const login = async (req, res) => {
  const { idNumber, password } = req.body;

  console.log('🔐 Login attempt for ID:', idNumber);
  console.log('📝 Password provided:', password ? 'Yes (length: ' + password.length + ')' : 'No');

  try {
    // Find user by ID number
    const user = await prisma.user.findUnique({
      where: { idNumber: idNumber.trim() },
      include: {
        student: true,
        teacher: true,
        admin: true
      }
    });

    console.log('👤 User lookup result:', user ? `Found user ${user.id}` : 'No user found');
    console.log('🏫 User school:', user?.school);
    console.log('🔐 User stored hash:', user?.password ? 'Exists' : 'Missing');

    if (!user) {
      console.log('❌ No user found with ID:', idNumber);
      return res.render('auth/login', { 
        title: 'Login',
        hideNavbar: true,
        error: 'Invalid ID number or password',
        success: null
      });
    }

    // Check if account is active
    if (!user.isActive) {
      console.log('❌ User account inactive:', user.id);
      return res.render('auth/login', { 
        title: 'Login',
        hideNavbar: true,
        error: 'Account is deactivated. Please contact administrator.',
        success: null
      });
    }

    // Debug password comparison
    console.log('🔍 Starting password comparison...');
    console.log('📥 Input password:', `"${password}"`);
    console.log('📤 Stored hash length:', user.password.length);
    
    const isMatch = await comparePassword(password, user.password);
    console.log('✅ Password match result:', isMatch);

    if (!isMatch) {
      console.log('❌ Password comparison failed for user:', user.id);
      return res.render('auth/login', { 
        title: 'Login',
        hideNavbar: true,
        error: 'Invalid ID number or password',
        success: null
      });
    }

    console.log('🎉 Login successful for user:', user.id);

    // Set session
    req.session.user = {
      id: user.id,
      idNumber: user.idNumber,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      avatar: user.avatar,
      school: user.school
    };

    // Add role-specific ID if exists
    if (user.role === 'student' && user.student) {
      req.session.user.studentId = user.student.id;
      console.log('🎓 Student ID added to session:', user.student.id);
    } else if (user.role === 'teacher' && user.teacher) {
      req.session.user.teacherId = user.teacher.id;
      console.log('👨‍🏫 Teacher ID added to session:', user.teacher.id);
    } else if (user.role === 'admin' && user.admin) {
      req.session.user.adminId = user.admin.id;
      console.log('👨‍💼 Admin ID added to session:', user.admin.id);
    }

    console.log('💾 Session created successfully');
    console.log('📋 Session data:', JSON.stringify(req.session.user, null, 2));

    // Redirect based on role
    if (user.role === 'student') {
      console.log('➡️ Redirecting to student dashboard');
      res.redirect('/student/dashboard');
    } else if (user.role === 'teacher') {
      console.log('➡️ Redirecting to teacher dashboard');
      res.redirect('/teacher/dashboard');
    } else if (user.role === 'admin') {
      console.log('➡️ Redirecting to admin dashboard');
      res.redirect('/admin/dashboard');
    } else {
      console.log('➡️ Redirecting to home');
      res.redirect('/');
    }
  } catch (error) {
    console.error('💥 Login error details:', error);
    res.render('auth/login', { 
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
    // Validate new password confirmation
    if (newPassword !== confirmPassword) {
      return res.render('auth/change-password', {
        title: 'Change Password',
        error: 'New passwords do not match',
        success: null
      });
    }

    // Get user from database
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

    // Verify current password
    const isMatch = await comparePassword(currentPassword, user.password);

    if (!isMatch) {
      return res.render('auth/change-password', {
        title: 'Change Password',
        error: 'Current password is incorrect',
        success: null
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password in database
    await prisma.user.update({
      where: { id: userId },
      data: { 
        password: hashedPassword,
        isTemporaryPassword: false,
        passwordChangedAt: new Date()
      }
    });

    res.render('auth/change-password', {
      title: 'Change Password',
      error: null,
      success: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Password change error:', error);
    res.render('auth/change-password', {
      title: 'Change Password',
      error: 'An error occurred while changing password',
      success: null
    });
  }
};

// Logout
const logout = (req, res) => {
  console.log('👋 User logging out:', req.session.user?.idNumber);
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
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