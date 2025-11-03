const prisma = require('../config/database');
const { hashPassword } = require('../utils/passwordUtils');
const { getActivityIcon, getActivityBadgeColor } = require('../utils/activityHelpers');

const generateTemporaryPassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

const calculatePasswordExpiry = (days = 30) => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry;
};

// Add this helper function at the top
const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

// Add the missing formatTimeAgo function
function formatTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  } else if (diffInSeconds < 2592000) {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Admin dashboard
const dashboard = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Build where clauses for school filtering
    let studentWhere = {};
    let teacherWhere = {};
    let classWhere = {};
    let assignmentWhere = {};
    let activityWhere = {};
    
    // Apply school filtering for non-super admins
    if (userSchool && !isSuperAdmin) {
      studentWhere = { user: { school: userSchool } };
      teacherWhere = { user: { school: userSchool } };
      classWhere = { teacher: { user: { school: userSchool } } };
      assignmentWhere = { teacher: { user: { school: userSchool } } };
      activityWhere = { school: userSchool };
    }
    const totalStudents = await prisma.student.count({ where: studentWhere });
    const totalTeachers = await prisma.teacher.count({ where: teacherWhere });
    const totalClasses = await prisma.class.count({ where: classWhere });
    const totalAssignments = await prisma.assignment.count({ where: assignmentWhere });

    // Get recent activities with school filtering
    const recentActivities = await prisma.user.findMany({
      where: activityWhere,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { student: true, teacher: true, admin: true }
    });

    const formattedActivities = recentActivities.map(activity => ({
      id: activity.id,
      firstName: activity.firstName,
      lastName: activity.lastName,
      role: activity.role,
      createdAt: activity.createdAt,
      idNumber: activity.idNumber,
      email: activity.email,
      studentInfo: activity.student,
      teacherInfo: activity.teacher,
      adminInfo: activity.admin
    }));

    // Get notifications
    const notifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        read: false,
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null }
        ]
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });

    const notificationCount = await prisma.notification.count({
      where: {
        userId: userId,
        read: false,
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null }
        ]
      }
    });

    // Format notifications for display
    const formattedNotifications = notifications.map(notif => ({
      id: notif.id,
      title: notif.title,
      message: notif.message,
      icon: notif.icon,
      time: formatTimeAgo(notif.createdAt),
      read: notif.read
    }));

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      overview: {
        totalStudents,
        totalTeachers,
        totalClasses,
        totalAssignments
      },
      recentActivities: formattedActivities,
      notifications: formattedNotifications,
      notificationCount: notificationCount,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
   } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};



// Update createUser to use "12345" as default temporary password
const createUser = async (req, res) => {
  try {
    const { idNumber, firstName, lastName, email, phone, role, grade, section, subject, roleLevel, dateOfBirth, tuitionStatus, receiptNumber, school } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('👤 Creating new user with ID:', idNumber);
    console.log('🎭 Role:', role);

    // Validate required fields
    if (!idNumber || !firstName || !lastName || !role) {
      return res.status(400).redirect('/admin/users?error=All required fields must be filled');
    }

    // Check if ID number already exists
    const existingUser = await prisma.user.findUnique({
      where: { idNumber: idNumber.trim() }
    });

    if (existingUser) {
      console.log('❌ ID Number already exists:', idNumber);
      return res.redirect('/admin/users?error=ID Number already exists');
    }

    // Determine school for new user
    let assignedSchool;
    if (isSuperAdmin) {
      assignedSchool = school || null;
    } else {
      assignedSchool = userSchool;
    }

    // USE "12345" AS DEFAULT TEMPORARY PASSWORD
    const tempPassword = "12345";
    console.log('🔐 Using default temporary password:', tempPassword);
    
    const hashedPassword = await hashPassword(tempPassword);
    console.log('🔑 Hashed password created successfully');
    
    // Parse date of birth
    const parsedDateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    
    // Create user with school assignment
    const user = await prisma.user.create({
      data: {
        idNumber: idNumber.trim(),
        password: hashedPassword,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email ? email.trim() : null,
        phone: phone ? phone.trim() : null,
        role,
        dateOfBirth: parsedDateOfBirth,
        avatar: req.file ? req.file.path : null,
        isTemporaryPassword: true,
        school: assignedSchool,
        isActive: true
      }
    });

    console.log('✅ User created successfully with ID:', user.id);
    
    // Create role-specific record
    if (role === 'student') {
      if (!grade || !section) {
        // Clean up the user if student data is invalid
        await prisma.user.delete({ where: { id: user.id } });
        return res.status(400).redirect('/admin/users?error=Grade and section are required for students');
      }

      // Set tuition status and password change ability
      const canChangePassword = tuitionStatus === 'paid';
      const tempPasswordExpiry = tuitionStatus === 'partial' ? calculatePasswordExpiry(30) : null;

      await prisma.student.create({
        data: {
          userId: user.id,
          grade: grade.trim(),
          section: section.trim(),
          tuitionStatus: tuitionStatus || 'unpaid',
          canChangePassword: canChangePassword,
          tempPasswordExpiry: tempPasswordExpiry
        }
      });

      console.log('🎓 Student record created');

      // Create tuition payment record if receipt number provided
      if (receiptNumber && tuitionStatus === 'paid') {
        await prisma.tuitionPayment.create({
          data: {
            receiptNumber: receiptNumber.trim(),
            amount: 0,
            status: 'verified',
            verifiedBy: req.session.user.id,
            verifiedAt: new Date(),
            studentId: user.id,
            semester: `${new Date().getFullYear()}-1`
          }
        });
        console.log('💰 Tuition payment recorded');
      }

    } else if (role === 'teacher') {
      if (!subject) {
        // Clean up the user if teacher data is invalid
        await prisma.user.delete({ where: { id: user.id } });
        return res.status(400).redirect('/admin/users?error=Subject is required for teachers');
      }
      
      await prisma.teacher.create({
        data: {
          userId: user.id,
          subject: subject.trim()
        }
      });
      console.log('👨‍🏫 Teacher record created');
      
    } else if (role === 'admin') {
      await prisma.admin.create({
        data: {
          userId: user.id,
          roleLevel: roleLevel || 'administrator'
        }
      });
      console.log('👨‍💼 Admin record created');
    }

    console.log('🎉 User creation completed successfully');
    res.redirect('/admin/users?success=User created successfully. Temporary password: 12345');
    
  } catch (error) {
    console.error('💥 Create user error:', error);
    if (error.code === 'P2002') {
      res.redirect('/admin/users?error=User with this ID number already exists');
    } else {
      res.redirect('/admin/users?error=Server error occurred while creating user');
    }
  }
};


// NEW: Manage tuition payments
const manageTuition = async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: {
        user: {
          select: {
            id: true,
            idNumber: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            isActive: true
          }
        },
        tuitionPayments: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 5
        },
        enrollments: {
          include: {
            class: true
          }
        }
      },
      orderBy: {
        user: {
          firstName: 'asc'
        }
      }
    });

    res.render('admin/tuition-management', {
      title: 'Tuition Management',
      students
    });
  } catch (error) {
    console.error('Manage tuition error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// NEW: Record tuition payment
const recordPayment = async (req, res) => {
  try {
    const { studentId, receiptNumber, amount, semester, paymentDate } = req.body;
    const adminId = req.session.user.id;

    // Validate required fields
    if (!studentId || !receiptNumber) {
      return res.status(400).json({ success: false, message: 'Student ID and receipt number are required' });
    }

    // Check if receipt number already exists
    const existingPayment = await prisma.tuitionPayment.findUnique({
      where: { receiptNumber }
    });

    if (existingPayment) {
      return res.status(400).json({ success: false, message: 'Receipt number already exists' });
    }

    // Create payment record
    const payment = await prisma.tuitionPayment.create({
      data: {
        receiptNumber,
        amount: parseFloat(amount) || 0,
        status: 'verified',
        verifiedBy: adminId,
        verifiedAt: new Date(),
        studentId: parseInt(studentId),
        semester: semester || `${new Date().getFullYear()}-1`,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date()
      }
    });

    // Update student's tuition status and password permissions
    await prisma.student.update({
      where: { id: parseInt(studentId) },
      data: {
        tuitionStatus: 'paid',
        canChangePassword: true,
        tempPasswordExpiry: null
      }
    });

    // Update user's temporary password status
    const student = await prisma.student.findUnique({
      where: { id: parseInt(studentId) },
      include: { user: true }
    });

    if (student && student.user.isTemporaryPassword) {
      await prisma.user.update({
        where: { id: student.userId },
        data: {
          isTemporaryPassword: false
        }
      });
    }

    res.json({
      success: true,
      message: 'Payment recorded successfully and student can now change password',
      payment
    });

  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({ success: false, message: 'Failed to record payment' });
  }
};

// NEW: Reset student password with tuition check
const resetStudentPassword = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { passwordType } = req.body; // 'full' or 'temporary'

    const student = await prisma.student.findUnique({
      where: { id: parseInt(studentId) },
      include: { user: true }
    });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    let newPassword;
    let isTemporary = false;
    let tempPasswordExpiry = null;

    if (passwordType === 'temporary') {
      // Generate temporary password that expires
      newPassword = generateTemporaryPassword();
      isTemporary = true;
      tempPasswordExpiry = calculatePasswordExpiry(30); // 30 days expiry

      // Update student record
      await prisma.student.update({
        where: { id: parseInt(studentId) },
        data: {
          canChangePassword: false,
          tempPasswordExpiry: tempPasswordExpiry
        }
      });
    } else {
      // Generate permanent password (only for paid students)
      if (student.tuitionStatus !== 'paid') {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot set permanent password for unpaid students' 
        });
      }
      newPassword = generateTemporaryPassword(); // Still temporary but can be changed
      isTemporary = false;
    }

    const hashedPassword = await hashPassword(newPassword);

    // Update user password
    await prisma.user.update({
      where: { id: student.userId },
      data: {
        password: hashedPassword,
        isTemporaryPassword: isTemporary,
        passwordChangedAt: isTemporary ? null : new Date()
      }
    });

    res.json({
      success: true,
      message: `Password reset successfully`,
      newPassword: newPassword, // Send back to show admin
      isTemporary: isTemporary,
      expiryDate: tempPasswordExpiry
    });

  } catch (error) {
    console.error('Reset student password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
};

// NEW: Check password expiry
const checkPasswordExpiry = async (req, res) => {
  try {
    const now = new Date();
    const expiredStudents = await prisma.student.findMany({
      where: {
        tempPasswordExpiry: {
          lt: now
        },
        tuitionStatus: {
          not: 'paid'
        }
      },
      include: {
        user: {
          select: {
            idNumber: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    res.json({
      success: true,
      expiredStudents,
      count: expiredStudents.length
    });
  } catch (error) {
    console.error('Check password expiry error:', error);
    res.status(500).json({ success: false, message: 'Failed to check password expiry' });
  }
};

// Update the existing manageUsers function
const manageUsers = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    const canSeeAllSchoolUsers = req.canSeeAllSchoolUsers;
    
    // Log access level for debugging
    console.log('manageUsers - Access Level:', {
      school: userSchool,
      isSuperAdmin: isSuperAdmin,
      canSeeAllSchoolUsers: canSeeAllSchoolUsers,
      userRole: req.user.role,
      adminRoleLevel: req.user.admin ? req.user.admin.roleLevel : 'N/A'
    });

    // Build where clause for school filtering
    let whereClause = {};
    
    if (isSuperAdmin) {
      // For super admin - no school filter, show all users
      console.log('🔓 Super Admin - showing all users from all schools');
      // whereClause remains empty to get all users
    } else if (userSchool) {
      // For principals, headteachers, school admins - only show users from their school
      whereClause = {
        school: userSchool
      };
      console.log(`🔒 School filtering applied: ${userSchool}`);
    } else {
      // No school assigned and not super admin - show no users
      console.log('❌ No school assigned and not super admin - showing no users');
      whereClause = {
        school: 'NON_EXISTENT_SCHOOL' // This will return no results
      };
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      include: {
        student: {
          include: {
            tuitionPayments: {
              orderBy: {
                createdAt: 'desc'
              },
              take: 1
            }
          }
        },
        teacher: true,
        admin: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Calculate age for each user dynamically
    const usersWithAge = users.map(user => ({
      ...user,
      age: calculateAge(user.dateOfBirth)
    }));

    // Calculate tuition statistics
    const now = new Date();
    
    const paidStudents = users.filter(user => 
      user.role === 'student' && 
      user.student && 
      user.student.tuitionStatus === 'paid'
    ).length;

    const partialStudents = users.filter(user => 
      user.role === 'student' && 
      user.student && 
      user.student.tuitionStatus === 'partial'
    ).length;

    const unpaidStudents = users.filter(user => 
      user.role === 'student' && 
      user.student && 
      user.student.tuitionStatus === 'unpaid'
    ).length;

    const expiredStudents = users.filter(user => {
      if (user.role === 'student' && user.student && user.student.tuitionStatus === 'partial') {
        return user.student.tempPasswordExpiry && new Date(user.student.tempPasswordExpiry) < now;
      }
      return false;
    }).length;
    
    // Get query parameters for success/error messages
    const success = req.query.success;
    const error = req.query.error;
    
    res.render('admin/users', { 
      title: 'User Management',
      users: usersWithAge,
      paidStudents,
      partialStudents,
      unpaidStudents,
      expiredStudents,
      userSchool,
      isSuperAdmin,
      canSeeAllSchoolUsers,
      userRole: req.user.role,
      adminInfo: req.user.admin,
      success,
      error,
      getAccessStatus
    });
  } catch (error) {
    console.error('Manage users error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Toggle user active status
const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Convert userId to integer
    const userIdInt = parseInt(userId);
    
    // Check if conversion was successful
    if (isNaN(userIdInt)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }
    
    const user = await prisma.user.findUnique({
      where: { id: userIdInt } // Use the converted integer
    });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const updatedUser = await prisma.user.update({
      where: { id: userIdInt }, // Use the converted integer
      data: { isActive: !user.isActive }
    });
    
    res.json({ 
      success: true, 
      isActive: updatedUser.isActive,
      message: `User ${updatedUser.isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ENHANCED: Get user for editing with date of birth
const getUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Convert userId to integer
    const userIdInt = parseInt(userId);
    
    // Check if conversion was successful
    if (isNaN(userIdInt)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }
    
    const user = await prisma.user.findUnique({
      where: { id: userIdInt }, // Use the converted integer
      include: {
        student: true,
        teacher: true,
        admin: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Format date for input field (YYYY-MM-DD)
    const formattedUser = {
      ...user,
      dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().split('T')[0] : null
    };
    
    res.json({ success: true, user: formattedUser });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ENHANCED: Update user with date of birth
const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Convert userId to integer
    const userIdInt = parseInt(userId);
    
    // Check if conversion was successful
    if (isNaN(userIdInt)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }
    
    const { firstName, lastName, email, phone, grade, section, subject, roleLevel, dateOfBirth, tuitionStatus, receiptNumber, school } = req.body;
    
    // Find user first
    const user = await prisma.user.findUnique({
      where: { id: userIdInt },
      include: {
        student: true,
        teacher: true,
        admin: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Parse date of birth
    const parsedDateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    
    // Update user basic info including school
    const updatedUser = await prisma.user.update({
      where: { id: userIdInt },
      data: {
        firstName,
        lastName,
        email,
        phone,
        dateOfBirth: parsedDateOfBirth,
        avatar: req.file ? req.file.path : user.avatar,
        school: school
      }
    });
    
    // Update role-specific info
    if (user.role === 'student' && user.student) {
      // Set password permissions based on tuition status
      const canChangePassword = tuitionStatus === 'paid';
      const tempPasswordExpiry = tuitionStatus === 'partial' ? calculatePasswordExpiry(30) : null;

      await prisma.student.update({
        where: { id: user.student.id }, // Use student.id, not userId
        data: { 
          grade, 
          section,
          tuitionStatus: tuitionStatus || 'unpaid',
          canChangePassword: canChangePassword,
          tempPasswordExpiry: tempPasswordExpiry
        }
      });

      // Create tuition payment record if receipt number provided and status is paid
      if (receiptNumber && tuitionStatus === 'paid') {
        // Check if receipt number already exists
        const existingPayment = await prisma.tuitionPayment.findUnique({
          where: { receiptNumber }
        });

        if (!existingPayment) {
          await prisma.tuitionPayment.create({
            data: {
              receiptNumber,
              amount: 0, // You can set actual amount if needed
              status: 'verified',
              verifiedBy: req.session.user.id,
              verifiedAt: new Date(),
              studentId: user.student.id, // FIX: Use student.id instead of user.id
              semester: `${new Date().getFullYear()}-1`
            }
          });
        }
      }

      // Update user's temporary password status if tuition is paid
      if (tuitionStatus === 'paid') {
        await prisma.user.update({
          where: { id: userIdInt },
          data: {
            isTemporaryPassword: false
          }
        });
      }
    } else if (user.role === 'teacher' && user.teacher) {
      await prisma.teacher.update({
        where: { id: user.teacher.id },
        data: { subject }
      });
    } else if (user.role === 'admin' && user.admin) {
      await prisma.admin.update({
        where: { id: user.admin.id },
        data: { roleLevel }
      });
    }
    
    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    
    // More specific error handling
    if (error.code === 'P2003') {
      return res.status(400).json({ 
        success: false, 
        message: 'Database constraint error: Invalid student reference' 
      });
    }
    
    res.status(500).json({ success: false, message: 'Server error occurred while updating user' });
  }
};


// Manage classes
const manageClasses = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    let classWhere = {};
    let teacherWhere = {};
    
    if (userSchool && !isSuperAdmin) {
      classWhere = {
        teacher: {
          user: {
            school: userSchool
          }
        }
      };
      teacherWhere = {
        user: {
          school: userSchool
        }
      };
    }

    const classes = await prisma.class.findMany({
      where: classWhere,
      include: {
        teacher: {
          include: { user: true }
        },
        enrollments: {
          include: {
            student: {
              include: { user: true }
            }
          }
        }
      }
    });
    
    const teachers = await prisma.teacher.findMany({
      where: teacherWhere,
      include: { user: true }
    });
    
    res.render('admin/classes', { 
      title: 'Class Management',
      classes, 
      teachers,
      userSchool,
      isSuperAdmin
    });
  } catch (error) {
    console.error('Manage classes error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Create class
const createClass = async (req, res) => {
  try {
    const { name, grade, section, teacherId } = req.body;
    
    // Validate required fields
    if (!name || !grade || !section || !teacherId) {
      return res.status(400).render('error/400', { title: 'Bad Request' });
    }
    
    await prisma.class.create({
      data: {
        name,
        grade,
        section,
        teacherId: parseInt(teacherId)
      }
    });
    
    res.redirect('/admin/classes');
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Admin analytics dashboard
const analytics = async (req, res) => {
  try {
    // Get statistics
    const totalStudents = await prisma.student.count();
    const totalTeachers = await prisma.teacher.count();
    const totalAdmins = await prisma.admin.count();
    const totalClasses = await prisma.class.count();
    const totalAssignments = await prisma.assignment.count();

    // Get activity data (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentMaterials = await prisma.material.count({
      where: { createdAt: { gte: thirtyDaysAgo } }
    });

    const recentAssignments = await prisma.assignment.count({
      where: { createdAt: { gte: thirtyDaysAgo } }
    });

    const recentSubmissions = await prisma.submission.count({
      where: { submittedAt: { gte: thirtyDaysAgo } }
    });

    // Get grade distribution
    const submissions = await prisma.submission.findMany({
      where: { grade: { not: null } },
      select: { grade: true }
    });

    const grades = submissions.map(s => s.grade);
    const averageGrade = grades.length > 0 ? 
      grades.reduce((sum, grade) => sum + grade, 0) / grades.length : 0;

    // Count grades by range
    const gradeRanges = { '90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, '0-59': 0 };
    
    grades.forEach(grade => {
      if (grade >= 90) gradeRanges['90-100']++;
      else if (grade >= 80) gradeRanges['80-89']++;
      else if (grade >= 70) gradeRanges['70-79']++;
      else if (grade >= 60) gradeRanges['60-69']++;
      else gradeRanges['0-59']++;
    });

    // Get recent user activities (last 10 created users)
    const recentActivities = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        student: true,
        teacher: true,
        admin: true
      }
    });

    res.render('admin/analytics', {
      title: 'Analytics Dashboard',
      overview: {
        totalStudents,
        totalTeachers,
        totalAdmins,
        totalClasses,
        totalAssignments,
        recentMaterials,
        recentAssignments,
        recentSubmissions
      },
      grades: {
        average: averageGrade,
        distribution: gradeRanges
      },
      recentActivities
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// System activities log
const activitiesLog = async (req, res) => {
  try {
    // Get basic counts for statistics
    const totalActivities = await prisma.user.count() + await prisma.assignment.count();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayActivities = await prisma.user.count({
      where: { createdAt: { gte: today } }
    });
    
    const uniqueUsers = await prisma.user.count();
    const systemActivities = await prisma.assignment.count();

    // Get recent users as sample activities
    const recentUsers = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        student: true,
        teacher: true,
        admin: true
      }
    });

    // Convert users to activity format
    const activities = recentUsers.map(user => ({
      action: 'Account ' + (user.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000) ? 'Created' : 'Accessed'),
      type: 'system',
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        idNumber: user.idNumber
      },
      details: `${user.role} account ${user.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000) ? 'created' : 'accessed'}`,
      timestamp: user.createdAt,
      ipAddress: '192.168.1.' + Math.floor(Math.random() * 255) // Sample IP
    }));

    // Add icon and color to each activity using the helper functions
    const activitiesWithIcons = activities.map(activity => ({
        ...activity,
        icon: getActivityIcon(activity.action),        // Precompute the icon
        badgeColor: getActivityBadgeColor(activity.type)  // Precompute the badge color
    }));

    res.render('admin/activities', {
      title: 'System Activities',
      activities: activitiesWithIcons,  // Use the transformed array
      totalActivities,
      todayActivities,
      uniqueUsers,
      systemActivities
    });
  } catch (error) {
    console.error('Activities log error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get class for editing
const getClass = async (req, res) => {
  try {
    const { classId } = req.params;
    
    const cls = await prisma.class.findUnique({
      where: { id: parseInt(classId) },
      include: {
        teacher: {
          include: { user: true }
        }
      }
    });
    
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // Get all teachers for the dropdown
    const teachers = await prisma.teacher.findMany({
      include: { user: true }
    });
    
    res.json({ success: true, class: cls, teachers });
  } catch (error) {
    console.error('Get class error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update class
const updateClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const { name, grade, section, teacherId } = req.body;
    
    // Validate required fields
    if (!name || !grade || !section || !teacherId) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    // Check if class exists
    const existingClass = await prisma.class.findUnique({
      where: { id: parseInt(classId) }
    });
    
    if (!existingClass) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // Update class
    await prisma.class.update({
      where: { id: parseInt(classId) },
      data: {
        name,
        grade,
        section,
        teacherId: parseInt(teacherId)
      }
    });
    
    res.json({ success: true, message: 'Class updated successfully' });
  } catch (error) {
    console.error('Update class error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Delete class
const deleteClass = async (req, res) => {
  try {
    const { classId } = req.params;
    
    // Check if class exists
    const existingClass = await prisma.class.findUnique({
      where: { id: parseInt(classId) }
    });
    
    if (!existingClass) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // Delete class (Prisma will handle cascading deletes if set up in schema)
    await prisma.class.delete({
      where: { id: parseInt(classId) }
    });
    
    res.json({ success: true, message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// View students in a class
const viewClassStudents = async (req, res) => {
  try {
    const { classId } = req.params;
    
    const classData = await prisma.class.findUnique({
      where: { id: parseInt(classId) },
      include: {
        teacher: {
          include: { user: true }
        },
        enrollments: {
          include: {
            student: {
              include: { user: true }
            }
          }
        }
      }
    });
    
    if (!classData) {
      return res.status(404).render('error/404', { title: 'Class Not Found' });
    }
    
    res.render('admin/class-students', {
      title: `Students in ${classData.name}`,
      classData: classData // Changed from 'class' to 'classData'
    });
  } catch (error) {
    console.error('View class students error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get students for enrollment
const getEnrollStudents = async (req, res) => {
  try {
    const classId = parseInt(req.params.classId);
    
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        enrollments: {
          include: {
            student: {
              include: { user: true }
            }
          }
        },
        teacher: {
          include: { user: true }
        }
      }
    });

    if (!classData) {
      return res.status(404).render('error/404', { title: 'Class Not Found' });
    }

    const allStudents = await prisma.student.findMany({
      include: {
        user: true,
        enrollments: {
          where: {
            classId: classId
          }
        }
      }
    });

    // Filter out students already enrolled
    const availableStudents = allStudents.filter(student => 
      student.enrollments.length === 0
    );

    // Ensure arrays exist
    const enrolledStudents = classData.enrollments || [];
    const availableStudentsList = availableStudents || [];

    // Get query parameters for messages
    const success = req.query.success;
    const error = req.query.error;

    res.render('admin/enroll-students', {
      title: `Enroll Students - ${classData.name}`,
      classData: classData,
      enrolledStudents: enrolledStudents,
      availableStudents: availableStudentsList,
      success: success,
      error: error
    });
  } catch (error) {
    console.error('Get enroll students error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Enroll students in class
const enrollStudents = async (req, res) => {
  try {
    const classId = parseInt(req.params.classId);
    const { studentIds } = req.body;

    // Check if studentIds exists and is an array
    if (!studentIds) {
      return res.redirect(`/admin/classes/${classId}/enroll?error=Please select at least one student to enroll.`);
    }

    // Handle case where studentIds is a single value (not array)
    const studentIdsArray = Array.isArray(studentIds) ? studentIds : [studentIds];

    if (studentIdsArray.length === 0) {
      return res.redirect(`/admin/classes/${classId}/enroll?error=Please select at least one student to enroll.`);
    }

    // Create enrollment records
    const enrollments = studentIdsArray.map(studentId => ({
      classId: classId,
      studentId: parseInt(studentId)
    }));

    await prisma.enrollment.createMany({
      data: enrollments,
      skipDuplicates: true
    });

    return res.redirect(`/admin/classes/${classId}/enroll?success=Successfully enrolled ${studentIdsArray.length} student(s) in the class.`);
    
  } catch (error) {
    console.error('Enroll students error:', error);
    
    if (error.code === 'P2002') {
      return res.redirect(`/admin/classes/${classId}/enroll?error=One or more students are already enrolled in this class.`);
    }
    
    return res.redirect(`/admin/classes/${classId}/enroll?error=Server error occurred while enrolling students.`);
  }
};

// Remove student from class
const removeStudent = async (req, res) => {
  try {
    const classId = parseInt(req.params.classId);
    const studentId = parseInt(req.params.studentId);

    console.log(`Removing student ${studentId} from class ${classId}`);

    // Use deleteMany which doesn't require composite key
    const result = await prisma.enrollment.deleteMany({
      where: {
        AND: [
          { classId: classId },
          { studentId: studentId }
        ]
      }
    });

    console.log(`Delete result: ${result.count} records deleted`);

    if (result.count === 0) {
      return res.redirect(`/admin/classes/${classId}/enroll?error=Student not found in this class`);
    }

    res.redirect(`/admin/classes/${classId}/enroll?success=Student removed successfully`);
  } catch (error) {
    console.error('Remove student error:', error);
    res.redirect(`/admin/classes/${classId}/enroll?error=Error removing student: ${error.message}`);
  }
};

// Get analytics data for dashboard
const getAnalyticsData = async (req, res) => {
  try {
    // Get statistics
    const totalStudents = await prisma.student.count();
    const totalTeachers = await prisma.teacher.count();
    const totalAdmins = await prisma.admin.count();
    const totalClasses = await prisma.class.count();
    const totalAssignments = await prisma.assignment.count();

    // Get activity data (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentMaterials = await prisma.material.count({
      where: { createdAt: { gte: thirtyDaysAgo } }
    });

    const recentAssignments = await prisma.assignment.count({
      where: { createdAt: { gte: thirtyDaysAgo } }
    });

    const recentSubmissions = await prisma.submission.count({
      where: { submittedAt: { gte: thirtyDaysAgo } }
    });

    res.json({
      totalStudents,
      totalTeachers,
      totalAdmins,
      totalClasses,
      totalAssignments,
      recentMaterials,
      recentAssignments,
      recentSubmissions
    });
  } catch (error) {
    console.error('Analytics data error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
};

// Get grade distribution data
const getGradesData = async (req, res) => {
  try {
    // Get grade distribution
    const submissions = await prisma.submission.findMany({
      where: { grade: { not: null } },
      select: { grade: true }
    });

    const grades = submissions.map(s => s.grade);
    
    // Count grades by range
    const distribution = { '90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, '0-59': 0 };
    
    grades.forEach(grade => {
      if (grade >= 90) distribution['90-100']++;
      else if (grade >= 80) distribution['80-89']++;
      else if (grade >= 70) distribution['70-79']++;
      else if (grade >= 60) distribution['60-69']++;
      else distribution['0-59']++;
    });

    res.json({ distribution });
  } catch (error) {
    console.error('Grades data error:', error);
    res.status(500).json({ error: 'Failed to fetch grades data' });
  }
};

// Get recent activities data
const getActivitiesData = async (req, res) => {
  try {
    // Get recent user activities (last 10 created users)
    const recentActivities = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        student: true,
        teacher: true,
        admin: true
      }
    });

    // Format activities for frontend
    const formattedActivities = recentActivities.map(activity => ({
      id: activity.id,
      firstName: activity.firstName,
      lastName: activity.lastName,
      idNumber: activity.idNumber,
      role: activity.role,
      createdAt: activity.createdAt,
      activityType: "account_created"
    }));

    res.json(formattedActivities);
  } catch (error) {
    console.error('Activities data error:', error);
    res.status(500).json({ error: 'Failed to fetch activities data' });
  }
};

// Get student tuition data
const getStudentTuition = async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const student = await prisma.student.findUnique({
      where: { userId: parseInt(studentId) },
      include: {
        user: {
          select: {
            id: true,
            idNumber: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        tuitionPayments: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 5
        }
      }
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    res.json({
      success: true,
      student: student
    });
  } catch (error) {
    console.error('Get student tuition error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update student tuition status
const updateStudentTuition = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { tuitionStatus, accessDays, receiptNumber } = req.body;
    
    // Find the student record first
    const student = await prisma.student.findUnique({
      where: { userId: parseInt(studentId) } // This finds by student's userId
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    // Set password permissions based on tuition status
    const canChangePassword = tuitionStatus === 'paid';
    const tempPasswordExpiry = tuitionStatus === 'partial' ? calculatePasswordExpiry(parseInt(accessDays) || 30) : null;
    
    // Update student tuition status
    await prisma.student.update({
      where: { id: student.id }, // Use student.id here
      data: {
        tuitionStatus: tuitionStatus,
        canChangePassword: canChangePassword,
        tempPasswordExpiry: tempPasswordExpiry
      }
    });
    
    // Create tuition payment record if receipt number provided and status is paid
    if (receiptNumber && tuitionStatus === 'paid') {
      const existingPayment = await prisma.tuitionPayment.findUnique({
        where: { receiptNumber }
      });
      
      if (!existingPayment) {
        await prisma.tuitionPayment.create({
          data: {
            receiptNumber,
            amount: 0,
            status: 'verified',
            verifiedBy: req.session.user.id,
            verifiedAt: new Date(),
            studentId: student.id, // Use student.id here
            semester: `${new Date().getFullYear()}-1`
          }
        });
      }
    }
    
    // Update user's temporary password status if tuition is paid
    if (tuitionStatus === 'paid') {
      await prisma.user.update({
        where: { id: parseInt(studentId) },
        data: {
          isTemporaryPassword: false
        }
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Tuition status updated successfully' 
    });
  } catch (error) {
    console.error('Update student tuition error:', error);
    
    if (error.code === 'P2003') {
      return res.status(400).json({ 
        success: false, 
        message: 'Database error: Invalid student reference' 
      });
    }
    
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Extend access for partial payment students
const extendAccess = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { days } = req.body;
    
    const student = await prisma.student.findUnique({
      where: { userId: parseInt(studentId) }
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    if (student.tuitionStatus !== 'partial') {
      return res.status(400).json({ success: false, message: 'Can only extend access for partial payment students' });
    }
    
    const newExpiry = calculatePasswordExpiry(parseInt(days) || 30);
    
    await prisma.student.update({
      where: { userId: parseInt(studentId) },
      data: {
        tempPasswordExpiry: newExpiry
      }
    });
    
    res.json({ 
      success: true, 
      message: `Access extended by ${days} days successfully`,
      newExpiry: newExpiry
    });
  } catch (error) {
    console.error('Extend access error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const manageSchools = async (req, res) => {
  try {
    // Only super admins can access this
    if (!req.isSuperAdmin) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    // Get all unique schools from users
    const schools = await prisma.user.groupBy({
      by: ['school'],
      where: {
        school: {
          not: null
        }
      },
      _count: {
        id: true
      }
    });

    res.render('admin/schools', {
      title: 'School Management',
      schools: schools.filter(s => s.school) // Remove null schools
    });
  } catch (error) {
    console.error('Manage schools error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

const checkIdNumber = async (req, res) => {
  try {
    const { idNumber } = req.params;
    
    const existingUser = await prisma.user.findUnique({
      where: { idNumber }
    });
    
    res.json({ available: !existingUser });
  } catch (error) {
    console.error('Check ID number error:', error);
    res.status(500).json({ available: false });
  }
};

// Add this helper function to calculate access status
function getAccessStatus(user) {
    if (user.role !== 'student' || !user.student) {
        return 'active';
    }
    
    const now = new Date();
    const hasAccess = user.student.tuitionStatus === 'paid' ||
        (user.student.tuitionStatus === 'partial' &&
         user.student.tempPasswordExpiry && 
         new Date(user.student.tempPasswordExpiry) > now);
    
    return hasAccess ? 'active' : 'no-access';
}

module.exports = {
  dashboard,
  createUser,
  manageTuition,
  recordPayment,
  resetStudentPassword,
  checkPasswordExpiry,
  manageUsers,
  manageClasses,
  createClass,
  analytics,
  activitiesLog,
  toggleUserStatus,
  getUser,
  updateUser,
  getClass,           
  updateClass,        
  deleteClass,        
  viewClassStudents,
  getEnrollStudents,
  enrollStudents,
  removeStudent,
  getAnalyticsData,
  getGradesData,
  getActivitiesData,
  getStudentTuition,
  updateStudentTuition,
  extendAccess,
  manageSchools,
  checkIdNumber
};