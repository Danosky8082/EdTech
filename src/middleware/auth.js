const prisma = require('../config/database');

// Check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    // Set req.user for consistency across all middleware
    req.user = req.session.user;
    next();
  } else {
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
      return res.status(403).send('Access denied. Please log in.');
    }

    // Check if user has admin role
    const allowedRoles = ['admin', 'administrator', 'headteacher', 'teacher', 'principal', 'superadmin'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).send('Access denied. Admin role required.');
    }

    // Fetch complete user data with admin details
    const completeUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        admin: true,
        teacher: true
      }
    });

    if (!completeUser) {
      return res.status(403).send('User not found.');
    }

    // Update req.user with complete data
    req.user = completeUser;
    next();
  } catch (error) {
    console.error('isAdmin middleware error:', error);
    res.status(500).send('Server error during authorization.');
  }
};

// Improved school context middleware
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

    // Fetch fresh user data with relationships to ensure we have the latest
    const freshUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        admin: true,
        teacher: true,
        student: true
      }
    });

    if (!freshUser) {
      console.log('User not found in database');
      req.isSuperAdmin = false;
      req.userSchool = null;
      req.canSeeAllSchoolUsers = false;
      return next();
    }

    // Update req.user with fresh data
    req.user = freshUser;

    // Determine user access level
    if (req.user.role === 'admin' && req.user.admin) {
      // Check for super admin (explicit superadmin role level)
      if (req.user.admin.roleLevel === 'superadmin') {
        req.isSuperAdmin = true;
        req.userSchool = null; // Super admin can see all schools
        req.canSeeAllSchoolUsers = true;
        console.log('✅ Super Admin detected - full system access');
      } else {
        // Regular admin (principal, headteacher, administrator) with school assignment
        req.isSuperAdmin = false;
        req.userSchool = req.user.school;
        req.canSeeAllSchoolUsers = true; // School admins can see all users in their school
        console.log(`✅ School Admin (${req.user.admin.roleLevel}) detected - school: ${req.user.school}`);
      }
    } else if (req.user.role === 'teacher') {
      // Teachers can only see their school data
      req.isSuperAdmin = false;
      req.userSchool = req.user.school;
      req.canSeeAllSchoolUsers = false;
      console.log(`✅ Teacher detected - school: ${req.user.school}`);
    } else if (req.user.role === 'student') {
      // Students can only see their own data
      req.isSuperAdmin = false;
      req.userSchool = req.user.school;
      req.canSeeAllSchoolUsers = false;
      console.log(`✅ Student detected - school: ${req.user.school}`);
    } else {
      // Default fallback
      req.isSuperAdmin = false;
      req.userSchool = req.user.school || null;
      req.canSeeAllSchoolUsers = false;
      console.log('❓ Unknown role or missing data');
    }

    console.log('setSchoolContext - Final Context:', {
      isSuperAdmin: req.isSuperAdmin,
      userSchool: req.userSchool,
      canSeeAllSchoolUsers: req.canSeeAllSchoolUsers
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
    canSeeAllSchoolUsers: req.canSeeAllSchoolUsers
  });
  next();
};

module.exports = {
  isAuthenticated,
  isStudent,
  isTeacher,
  isAdmin,
  restrictToSchool,
  setSchoolContext
};