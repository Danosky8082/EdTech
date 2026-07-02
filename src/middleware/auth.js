const prisma = require('../config/database');

// Check if user is authenticated (session-based)
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    req.user = req.session.user;
    next();
  } else {
    req.flash('error_msg', 'Please log in to view this resource');
    res.redirect('/auth/login');
  }
};

// Check if user is student
const isStudent = (req, res, next) => {
  if (req.user && req.user.role === 'student') {
    next();
  } else {
    res.status(403).send('Access denied. Student role required.');
  }
};

// Check if user is teacher
const isTeacher = (req, res, next) => {
  if (req.user && req.user.role === 'teacher') {
    next();
  } else {
    res.status(403).send('Access denied. Teacher role required.');
  }
};

// Check if user is admin - UPDATED to fetch complete user data
const isAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      req.flash('error_msg', 'Access denied. Please log in.');
      return res.redirect('/auth/login');
    }

    const allowedRoles = ['admin', 'administrator', 'headteacher', 'teacher', 'principal', 'superadmin'];
    if (!allowedRoles.includes(req.user.role)) {
      req.flash('error_msg', 'Access denied. Admin role required.');
      return res.redirect('/dashboard');
    }

    const completeUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        admin: true,
        teacher: true
      }
    });

    if (!completeUser) {
      req.flash('error_msg', 'User not found.');
      return res.redirect('/auth/login');
    }

    req.user = completeUser;
    next();
  } catch (error) {
    console.error('isAdmin middleware error:', error);
    req.flash('error_msg', 'Server error during authorization.');
    res.redirect('/auth/login');
  }
};

// Improved school context middleware - UPDATED TO INCLUDE CASHIER
const setSchoolContext = async (req, res, next) => {
  try {
    if (!req.user) {
      return next();
    }

    console.log('setSchoolContext - Starting with user:', {
      id: req.user.id,
      role: req.user.role,
      school: req.user.school,
      hasAdmin: !!req.user.admin,
      adminRoleLevel: req.user.admin ? req.user.admin.roleLevel : 'N/A'
    });

    const freshUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        admin: true,
        teacher: true,
        student: true,
        cashier: true,
        parent: true,
        accountant: true
      }
    });

    if (!freshUser) {
      console.log('User not found in database');
      req.isSuperAdmin = false;
      req.userSchool = null;
      req.canSeeAllSchoolUsers = false;
      return next();
    }

    req.user = freshUser;

    if (req.user.role === 'admin' && req.user.admin) {
      if (req.user.admin.roleLevel === 'superadmin') {
        req.isSuperAdmin = true;
        req.userSchool = null;
        req.canSeeAllSchoolUsers = true;
        console.log('✅ Super Admin detected - full system access');
      } else {
        req.isSuperAdmin = false;
        req.userSchool = req.user.school;
        req.canSeeAllSchoolUsers = true;
        console.log(`✅ School Admin (${req.user.admin.roleLevel}) detected - school: ${req.user.school}`);
      }
    } else if (req.user.role === 'teacher') {
      req.isSuperAdmin = false;
      req.userSchool = req.user.school;
      req.canSeeAllSchoolUsers = false;
      console.log(`✅ Teacher detected - school: ${req.user.school}`);
    } else if (req.user.role === 'student') {
      req.isSuperAdmin = false;
      req.userSchool = req.user.school;
      req.canSeeAllSchoolUsers = false;
      console.log(`✅ Student detected - school: ${req.user.school}`);
    } else if (req.user.role === 'cashier') {
      req.isSuperAdmin = false;
      let cashierSchool = null;
      if (req.user.cashier && req.user.cashier.school) {
        cashierSchool = req.user.cashier.school;
      } else if (req.user.school) {
        cashierSchool = req.user.school;
      } else if (req.user.cashier && req.user.cashier.schoolId) {
        const school = await prisma.school.findUnique({
          where: { id: req.user.cashier.schoolId },
          select: { name: true, id: true }
        });
        if (school) {
          cashierSchool = school.name;
        }
      }
      req.userSchool = cashierSchool;
      req.canSeeAllSchoolUsers = false;
      console.log(`✅ Cashier detected - school: ${cashierSchool || 'Not assigned'}`);
    } else if (req.user.role === 'parent') {
      req.isSuperAdmin = false;
      req.userSchool = req.user.school;
      req.canSeeAllSchoolUsers = false;
      console.log(`✅ Parent detected - school: ${req.user.school}`);
    } else if (req.user.role === 'accountant') {
      req.isSuperAdmin = false;
      req.userSchool = req.user.school;
      req.canSeeAllSchoolUsers = false;
      console.log(`✅ Accountant detected - school: ${req.user.school}`);
    } else {
      req.isSuperAdmin = false;
      req.userSchool = req.user.school || null;
      req.canSeeAllSchoolUsers = false;
      console.log('❓ Unknown role or missing data');
    }

    console.log('setSchoolContext - Final Context:', {
      isSuperAdmin: req.isSuperAdmin,
      userSchool: req.userSchool,
      canSeeAllSchoolUsers: req.canSeeAllSchoolUsers,
      userRole: req.user.role
    });

    next();
  } catch (error) {
    console.error('❌ Error setting school context:', error);
    req.isSuperAdmin = false;
    req.userSchool = null;
    req.canSeeAllSchoolUsers = false;
    next();
  }
};

// Keep restrictToSchool for backward compatibility
const restrictToSchool = (req, res, next) => {
  console.log('restrictToSchool - Context:', {
    school: req.userSchool,
    isSuperAdmin: req.isSuperAdmin,
    canSeeAllSchoolUsers: req.canSeeAllSchoolUsers,
    userRole: req.user?.role
  });
  
  if (!req.isSuperAdmin && !req.userSchool) {
    console.log('⚠️ User has no school assignment but is not super admin');
    const role = req.user?.role;
    let redirectPath = '/';
    switch(role) {
      case 'cashier': redirectPath = '/cashier/dashboard'; break;
      case 'teacher': redirectPath = '/teacher/dashboard'; break;
      case 'student': redirectPath = '/student/dashboard'; break;
      case 'parent': redirectPath = '/parent/dashboard'; break;
      case 'accountant': redirectPath = '/accountant/dashboard'; break;
      default: redirectPath = '/';
    }
    req.flash('error_msg', 'Your account is not assigned to any school. Please contact your administrator.');
    return res.redirect(redirectPath);
  }
  next();
};

// Middleware to check if user has specific role(s) - session-based
const ensureRole = (roles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash('error_msg', 'Please log in to view this resource');
      return res.redirect('/auth/login');
    }
    if (typeof roles === 'string') roles = [roles];
    if (roles.includes(req.session.user.role)) {
      return next();
    } else {
      req.flash('error_msg', 'You do not have permission to access this page');
      switch(req.session.user.role) {
        case 'admin': return res.redirect('/admin/dashboard');
        case 'teacher': return res.redirect('/teacher/dashboard');
        case 'student': return res.redirect('/student/dashboard');
        case 'parent': return res.redirect('/parent/dashboard');
        case 'cashier': return res.redirect('/cashier/dashboard');
        case 'accountant': return res.redirect('/accountant/dashboard');
        default: return res.redirect('/dashboard');
      }
    }
  };
};

// Check if user is accountant
const isAccountant = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'accountant') {
    return next();
  }
  req.session.error_msg = 'Access denied: Accountant role required';
  res.redirect('/');
};

// Check if user is cashier
const isCashier = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'cashier') {
    return next();
  }
  req.session.error_msg = 'Access denied: Cashier role required';
  res.redirect('/');
};

// ============================================================
// NEW MIDDLEWARE: Set student tuition status for views
// ============================================================
const setStudentTuitionStatus = async (req, res, next) => {
  // Default values for every request
  res.locals.isUnpaidStudent = false;
  res.locals.studentTuitionStatus = null;

  if (!req.session.user) {
    return next();
  }

  const userId = req.session.user.id;
  const userRole = req.session.user.role;

  if (userRole === 'student') {
    try {
      const student = await prisma.student.findUnique({
        where: { userId: userId },
        select: { tuitionStatus: true }
      });
      if (student) {
        res.locals.studentTuitionStatus = student.tuitionStatus;
        res.locals.isUnpaidStudent = student.tuitionStatus === 'unpaid';
      }
    } catch (error) {
      console.error('Error fetching student tuition status:', error);
    }
  }

  next();
};

// Convenience middleware for common role combinations
const ensureAdmin = ensureRole(['admin']);
const ensureTeacherOrAdmin = ensureRole(['admin', 'teacher']);
const ensureStaff = ensureRole(['admin', 'teacher', 'cashier', 'accountant']);

module.exports = {
  isAuthenticated,
  isStudent,
  isTeacher,
  isAdmin,
  restrictToSchool,
  setSchoolContext,
  setStudentTuitionStatus,   // <-- NEW EXPORT
  ensureRole,
  ensureAdmin,
  ensureTeacherOrAdmin,
  ensureStaff,
  isAccountant,
  isCashier
};