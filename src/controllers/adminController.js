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

// Helper function to calculate age
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

// Helper function to format time ago
function formatTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  }
  if (diffInSeconds < 2592000) {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }
  return date.toLocaleDateString();
}

// Generate unique parent ID
const generateParentId = async () => {
  const lastParent = await prisma.user.findFirst({
    where: { role: 'parent' },
    orderBy: { id: 'desc' }
  });

  let nextNumber = 1;
  if (lastParent) {
    const matches = lastParent.idNumber.match(/\d+/);
    if (matches) {
      nextNumber = parseInt(matches[0]) + 1;
    }
  }
  return `PAR${nextNumber.toString().padStart(4, '0')}`;
};

// Helper function to determine access status
function getAccessStatus(user) {
  if (user.role !== 'student' || !user.student) return 'active';
  const now = new Date();
  const hasAccess = user.student.tuitionStatus === 'paid' ||
    (user.student.tuitionStatus === 'partial' &&
     user.student.tempPasswordExpiry && 
     new Date(user.student.tempPasswordExpiry) > now);
  return hasAccess ? 'active' : 'no-access';
}

// ============================================================
// DASHBOARD
// ============================================================
const dashboard = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    let studentWhere = {};
    let teacherWhere = {};
    let classWhere = {};
    let assignmentWhere = {};
    let activityWhere = {};
    
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

    const notifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        read: false,
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null }
        ]
      },
      orderBy: { createdAt: 'desc' },
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

    const formattedNotifications = notifications.map(notif => ({
      id: notif.id,
      title: notif.title,
      message: notif.message,
      icon: notif.icon,
      time: formatTimeAgo(notif.createdAt),
      read: notif.read
    }));

    const currentAdmin = await prisma.admin.findUnique({
      where: { userId: userId }
    });

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
      isSuperAdmin: isSuperAdmin,
      adminInfo: currentAdmin
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null
    });
  }
};

// ============================================================
// CREATE USER (with fixed avatar path)
// ============================================================
const createUser = async (req, res) => {
  try {
    const { 
      idNumber, firstName, lastName, email, phone, role, grade, section, 
      subject, roleLevel, dateOfBirth, tuitionStatus, receiptNumber, school,
      parentFirstName, parentLastName, parentEmail, parentRelationship 
    } = req.body;
    
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    if (!idNumber || !firstName || !lastName || !role) {
      return res.redirect('/admin/users?error=All required fields must be filled');
    }

    const existingUser = await prisma.user.findUnique({
      where: { idNumber: idNumber.trim() }
    });

    if (existingUser) {
      return res.redirect('/admin/users?error=ID Number already exists');
    }

    let assignedSchool;
    if (isSuperAdmin) {
      assignedSchool = school || null;
    } else {
      assignedSchool = userSchool;
    }

    const tempPassword = "12345";
    const hashedPassword = await hashPassword(tempPassword);
    const parsedDateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;

    // 🔥 FIX: Store avatar as RELATIVE path
    const avatarPath = req.file ? `uploads/profiles/${req.file.filename}` : null;

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
        avatar: avatarPath,  // ✅ now relative
        isTemporaryPassword: true,
        school: assignedSchool,
        isActive: true
      }
    });

    let parentUser = null;

    if (role === 'student' && parentFirstName && parentLastName) {
      try {
        const parentIdNumber = await generateParentId();
        parentUser = await prisma.user.create({
          data: {
            idNumber: parentIdNumber,
            password: await hashPassword('12345'),
            firstName: parentFirstName.trim(),
            lastName: parentLastName.trim(),
            email: parentEmail ? parentEmail.trim() : null,
            role: 'parent',
            isTemporaryPassword: true,
            school: assignedSchool,
            isActive: true
          }
        });

        const parent = await prisma.parent.create({
          data: { userId: parentUser.id }
        });

        await prisma.wallet.create({
          data: {
            parentId: parent.id,
            balance: 0
          }
        });

        console.log('👨‍👦 Parent account created:', parentIdNumber);
      } catch (parentError) {
        console.error('Error creating parent account:', parentError);
      }
    }

    if (role === 'student') {
      if (!grade || !section) {
        await prisma.user.delete({ where: { id: user.id } });
        if (parentUser) {
          await prisma.user.delete({ where: { id: parentUser.id } });
        }
        return res.redirect('/admin/users?error=Grade and section are required for students');
      }

      const canChangePassword = tuitionStatus === 'paid';
      const tempPasswordExpiry = tuitionStatus === 'partial' ? calculatePasswordExpiry(30) : null;

      const student = await prisma.student.create({
        data: {
          userId: user.id,
          grade: grade.trim(),
          section: section.trim(),
          tuitionStatus: tuitionStatus || 'unpaid',
          canChangePassword: canChangePassword,
          tempPasswordExpiry: tempPasswordExpiry
        }
      });

      if (parentUser) {
        try {
          const parentRecord = await prisma.parent.findUnique({ 
            where: { userId: parentUser.id } 
          });
          if (parentRecord) {
            await prisma.studentParent.create({
              data: {
                parentId: parentRecord.id,
                studentId: student.id,
                relationship: parentRelationship || 'parent'
              }
            });
          }
        } catch (linkError) {
          console.error('Error linking parent to student:', linkError);
        }
      }

      if (receiptNumber && tuitionStatus === 'paid') {
        try {
          await prisma.tuitionPayment.create({
            data: {
              receiptNumber: receiptNumber.trim(),
              amount: 0,
              status: 'verified',
              verifiedBy: req.session.user.id,
              verifiedAt: new Date(),
              studentId: student.id,
              semester: `${new Date().getFullYear()}-1`
            }
          });
        } catch (paymentError) {
          console.error('Error creating tuition payment:', paymentError);
        }
      }
    } else if (role === 'teacher') {
      if (!subject) {
        await prisma.user.delete({ where: { id: user.id } });
        return res.redirect('/admin/users?error=Subject is required for teachers');
      }
      await prisma.teacher.create({
        data: {
          userId: user.id,
          subject: subject.trim()
        }
      });
    } else if (role === 'admin') {
      await prisma.admin.create({
        data: {
          userId: user.id,
          roleLevel: roleLevel || 'administrator'
        }
      });
    } else if (role === 'parent') {
      await prisma.parent.create({
        data: { userId: user.id }
      });
      await prisma.wallet.create({
        data: {
          parentId: (await prisma.parent.findUnique({ where: { userId: user.id } })).id,
          balance: 0
        }
      });
    } else if (role === 'cashier') {
      await prisma.cashier.create({
        data: {
          userId: user.id,
          employeeId: idNumber.trim()
        }
      });
    } else if (role === 'accountant') {
      await prisma.accountant.create({
        data: {
          userId: user.id,
          employeeId: idNumber.trim()
        }
      });
    }

    let successMessage = 'User created successfully. Temporary password: 12345';
    if (parentUser) {
      successMessage += `. Parent account created with ID: ${parentUser.idNumber} (Password: 12345)`;
    }

    return res.redirect(`/admin/users?success=${encodeURIComponent(successMessage)}`);
    
  } catch (error) {
    console.error('💥 Create user error:', error);
    if (error.code === 'P2002') {
      return res.redirect('/admin/users?error=User with this ID number or email already exists');
    } else if (error.code === 'P2003') {
      return res.redirect('/admin/users?error=Database constraint error - invalid reference');
    } else if (error.code === 'P2011') {
      return res.redirect('/admin/users?error=Required field is missing');
    } else {
      return res.redirect('/admin/users?error=Server error occurred while creating user: ' + error.message);
    }
  }
};

// ============================================================
// UPDATE USER (with fixed avatar path)
// ============================================================
const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { firstName, lastName, email, phone, grade, section, subject, roleLevel, dateOfBirth, tuitionStatus, receiptNumber, school } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        student: {
          include: { tuitionPayments: true }
        },
        teacher: true,
        admin: true,
        cashier: true,
        accountant: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const parsedDateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    
    // 🔥 FIX: Store avatar as RELATIVE path
    const avatarPath = req.file ? `uploads/profiles/${req.file.filename}` : user.avatar;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        email,
        phone,
        dateOfBirth: parsedDateOfBirth,
        avatar: avatarPath,  // ✅ now relative
        school: school
      }
    });
    
    if (user.role === 'student' && user.student) {
      const canChangePassword = tuitionStatus === 'paid';
      const tempPasswordExpiry = tuitionStatus === 'partial' ? calculatePasswordExpiry(30) : null;
      
      await prisma.student.update({
        where: { id: user.student.id },
        data: {
          grade,
          section,
          tuitionStatus,
          canChangePassword,
          tempPasswordExpiry
        }
      });
      
      if (tuitionStatus === 'paid' && receiptNumber) {
        const existingPayment = user.student.tuitionPayments && user.student.tuitionPayments.length > 0 
          ? user.student.tuitionPayments[0] 
          : null;
        
        if (existingPayment) {
          await prisma.tuitionPayment.update({
            where: { id: existingPayment.id },
            data: {
              receiptNumber: receiptNumber.trim(),
              amount: existingPayment.amount || 0,
              status: 'verified',
              verifiedBy: req.session.user.id,
              verifiedAt: new Date(),
              studentId: user.student.id
            }
          });
        } else {
          await prisma.tuitionPayment.create({
            data: {
              receiptNumber: receiptNumber.trim(),
              amount: 0,
              status: 'verified',
              verifiedBy: req.session.user.id,
              verifiedAt: new Date(),
              studentId: user.student.id,
              semester: `${new Date().getFullYear()}-1`
            }
          });
        }
        await prisma.user.update({
          where: { id: userId },
          data: { isTemporaryPassword: false }
        });
      } else if (tuitionStatus !== 'paid' && user.student.tuitionPayments && user.student.tuitionPayments.length > 0) {
        await prisma.tuitionPayment.update({
          where: { id: user.student.tuitionPayments[0].id },
          data: { status: 'invalid' }
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
    if (error.code === 'P2003') {
      return res.status(400).json({ 
        success: false, 
        message: 'Database constraint error: Invalid student reference' 
      });
    } else if (error.code === 'P2002') {
      return res.status(400).json({ 
        success: false, 
        message: 'Receipt number already exists for another student' 
      });
    }
    res.status(500).json({ success: false, message: 'Server error occurred while updating user' });
  }
};

// // Manage classes
// const manageClasses = async (req, res) => {
//   try {
//     const userSchool = req.userSchool;
//     const isSuperAdmin = req.isSuperAdmin;
    
//     let classWhere = {};
//     let teacherWhere = {};
    
//     if (userSchool && !isSuperAdmin) {
//       classWhere = {
//         teacher: {
//           user: {
//             school: userSchool
//           }
//         }
//       };
//       teacherWhere = {
//         user: {
//           school: userSchool
//         }
//       };
//     }

//     const classes = await prisma.class.findMany({
//       where: classWhere,
//       include: {
//         teacher: {
//           include: { user: true }
//         },
//         enrollments: {
//           include: {
//             student: {
//               include: { user: true }
//             }
//           }
//         }
//       }
//     });
    
//     const teachers = await prisma.teacher.findMany({
//       where: teacherWhere,
//       include: { user: true }
//     });
    
//     res.render('admin/classes', { 
//       title: 'Class Management',
//       classes, 
//       teachers,
//       userSchool,
//       isSuperAdmin,
//       adminInfo: req.user?.admin || null // FIXED: Added adminInfo
//     });
//   } catch (error) {
//     console.error('Manage classes error:', error);
//     res.status(500).render('error/500', { 
//       title: 'Server Error',
//       adminInfo: req.user?.admin || null // FIXED: Added adminInfo to error page
//     });
//   }
// };

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
        teacherId: teacherId
      }
    });
    
    res.redirect('/admin/classes');
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null // FIXED: Added adminInfo to error page
    });
  }
};

// Admin analytics dashboard
const analytics = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('📊 Loading analytics for user:', userId);
    console.log('🏫 User school:', userSchool);
    console.log('👑 Is super admin:', isSuperAdmin);

    // Build where clauses for school filtering
    let studentWhere = {};
    let teacherWhere = {};
    let adminWhere = {};
    let classWhere = {};
    let assignmentWhere = {};
    let materialWhere = {};
    let submissionWhere = {};
    let parentWhere = {};
    let userWhere = {};

    if (userSchool && !isSuperAdmin) {
      studentWhere = { user: { school: userSchool } };
      teacherWhere = { user: { school: userSchool } };
      adminWhere = { user: { school: userSchool } };
      classWhere = { teacher: { user: { school: userSchool } } };
      assignmentWhere = { teacher: { user: { school: userSchool } } };
      materialWhere = { teacher: { user: { school: userSchool } } };
      submissionWhere = { student: { user: { school: userSchool } } };
      parentWhere = { user: { school: userSchool } };
      userWhere = { school: userSchool };
      
      console.log(`🔒 Filtering analytics by school: ${userSchool}`);
    } else if (isSuperAdmin) {
      console.log('🔓 Super admin - showing analytics for all schools');
    } else {
      console.log('⚠️ No school assigned and not super admin');
      userWhere = { school: 'NON_EXISTENT_SCHOOL' };
    }

    // Get statistics with school filtering
    const [
      totalStudents,
      totalTeachers,
      totalAdmins,
      totalClasses,
      totalAssignments,
      totalParents,
      parentsWithWallet
    ] = await Promise.all([
      prisma.student.count({ where: studentWhere }),
      prisma.teacher.count({ where: teacherWhere }),
      prisma.admin.count({ where: adminWhere }),
      prisma.class.count({ where: classWhere }),
      prisma.assignment.count({ where: assignmentWhere }),
      prisma.parent.count({ where: parentWhere }),
      prisma.parent.count({
        where: {
          ...parentWhere,
          wallet: { isNot: null }
        }
      })
    ]);

    // Get total subjects
    const teacherSubjects = await prisma.teacher.findMany({
      where: teacherWhere,
      select: { subject: true }
    });
    const totalSubjects = [...new Set(teacherSubjects.map(t => t.subject))].length;

    // Get active students (just count students who are active) - FIXED: removed lastLoginAt
    const activeStudents = await prisma.user.count({
      where: {
        role: 'student',
        ...userWhere,
        isActive: true
      }
    });

    const activeTeachers = await prisma.user.count({
      where: {
        role: 'teacher',
        ...userWhere,
        isActive: true
      }
    });

    // Get activity data (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentMaterials = await prisma.material.count({
      where: { 
        createdAt: { gte: thirtyDaysAgo },
        ...materialWhere
      }
    });

    const recentAssignments = await prisma.assignment.count({
      where: { 
        createdAt: { gte: thirtyDaysAgo },
        ...assignmentWhere
      }
    });

    const recentSubmissions = await prisma.submission.count({
      where: { 
        submittedAt: { gte: thirtyDaysAgo },
        ...submissionWhere
      }
    });

    // Get grade distribution
    const submissions = await prisma.submission.findMany({
      where: {
        grade: { not: null },
        ...submissionWhere
      },
      select: { grade: true }
    });

    const grades = submissions.map(s => s.grade);
    const averageGrade = grades.length > 0 ? 
      (grades.reduce((sum, grade) => sum + grade, 0) / grades.length).toFixed(1) : 0;

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
      where: userWhere,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        student: true,
        teacher: true,
        admin: true,
        parent: true
      }
    });

    // Get tuition statistics
    const studentsForTuition = await prisma.student.findMany({
      where: studentWhere,
      select: {
        tuitionStatus: true
      }
    });

    const paidStudents = studentsForTuition.filter(s => s.tuitionStatus === 'paid').length;
    const partialStudents = studentsForTuition.filter(s => s.tuitionStatus === 'partial').length;
    const unpaidStudents = studentsForTuition.filter(s => s.tuitionStatus === 'unpaid').length;

    console.log(`📊 Analytics loaded: ${totalStudents} students, ${totalTeachers} teachers`);

    res.render('admin/analytics', {
      title: 'Analytics Dashboard',
      overview: {
        totalStudents,
        totalTeachers,
        totalAdmins,
        totalClasses,
        totalAssignments,
        totalSubjects,
        totalParents,
        parentsWithWallet,
        recentMaterials,
        recentAssignments,
        recentSubmissions,
        totalActiveStudents: activeStudents,
        totalActiveTeachers: activeTeachers
      },
      tuitionData: {
        paidStudents,
        partialStudents,
        unpaidStudents
      },
      grades: {
        average: averageGrade,
        distribution: gradeRanges,
        totalSubmissions: grades.length
      },
      recentActivities,
      currentUserSchool: userSchool,
      isSuperAdmin: isSuperAdmin,
      userRole: req.user?.role,
      adminRoleLevel: req.user?.admin?.roleLevel,
      adminInfo: req.user?.admin || null
    });
  } catch (error) {
    console.error('💥 Analytics error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      currentUserSchool: req.userSchool,
      isSuperAdmin: req.isSuperAdmin,
      adminInfo: req.user?.admin || null
    });
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
        icon: getActivityIcon(activity.action),
        badgeColor: getActivityBadgeColor(activity.type)
    }));

    res.render('admin/activities', {
      title: 'System Activities',
      activities: activitiesWithIcons,
      totalActivities,
      todayActivities,
      uniqueUsers,
      systemActivities,
      adminInfo: req.user?.admin || null // FIXED: Added adminInfo
    });
  } catch (error) {
    console.error('Activities log error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null // FIXED: Added adminInfo to error page
    });
  }
};

// // Get class for editing - FIXED: Remove parseInt
// const getClass = async (req, res) => {
//   try {
//     const { classId } = req.params;
    
//     const cls = await prisma.class.findUnique({
//       where: { id: classId },
//       include: {
//         teacher: {
//           include: { user: true }
//         }
//       }
//     });
    
//     if (!cls) {
//       return res.status(404).json({ success: false, message: 'Class not found' });
//     }
    
//     // Get all teachers for the dropdown
//     const teachers = await prisma.teacher.findMany({
//       include: { user: true }
//     });
    
//     res.json({ success: true, class: cls, teachers });
//   } catch (error) {
//     console.error('Get class error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

// // Update class - FIXED: Remove parseInt
// const updateClass = async (req, res) => {
//   try {
//     const { classId } = req.params;
//     const { name, grade, section, teacherId } = req.body;
    
//     // Validate required fields
//     if (!name || !grade || !section || !teacherId) {
//       return res.status(400).json({ success: false, message: 'All fields are required' });
//     }
    
//     // Check if class exists
//     const existingClass = await prisma.class.findUnique({
//       where: { id: classId }
//     });
    
//     if (!existingClass) {
//       return res.status(404).json({ success: false, message: 'Class not found' });
//     }
    
//     // Update class
//     await prisma.class.update({
//       where: { id: classId },
//       data: {
//         name,
//         grade,
//         section,
//         teacherId: teacherId
//       }
//     });
    
//     res.json({ success: true, message: 'Class updated successfully' });
//   } catch (error) {
//     console.error('Update class error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

// // Delete class - FIXED: Remove parseInt
// const deleteClass = async (req, res) => {
//   try {
//     const { classId } = req.params;
    
//     // Check if class exists
//     const existingClass = await prisma.class.findUnique({
//       where: { id: classId }
//     });
    
//     if (!existingClass) {
//       return res.status(404).json({ success: false, message: 'Class not found' });
//     }
    
//     // Delete class (Prisma will handle cascading deletes if set up in schema)
//     await prisma.class.delete({
//       where: { id: classId }
//     });
    
//     res.json({ success: true, message: 'Class deleted successfully' });
//   } catch (error) {
//     console.error('Delete class error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

// // View students in a class - FIXED: Remove parseInt
// const viewClassStudents = async (req, res) => {
//   try {
//     const { classId } = req.params;
    
//     const classData = await prisma.class.findUnique({
//       where: { id: classId },
//       include: {
//         teacher: {
//           include: { user: true }
//         },
//         enrollments: {
//           include: {
//             student: {
//               include: { user: true }
//             }
//           }
//         }
//       }
//     });
    
//     if (!classData) {
//       return res.status(404).render('error/404', { title: 'Class Not Found' });
//     }
    
//     res.render('admin/class-students', {
//       title: `Students in ${classData.name}`,
//       classData: classData,
//       adminInfo: req.user?.admin || null // FIXED: Added adminInfo
//     });
//   } catch (error) {
//     console.error('View class students error:', error);
//     res.status(500).render('error/500', { 
//       title: 'Server Error',
//       adminInfo: req.user?.admin || null // FIXED: Added adminInfo to error page
//     });
//   }
// };

// Get students for enrollment - UPDATED with school filtering
const getEnrollStudents = async (req, res) => {
  try {
    const { classId } = req.params;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('🔍 Fetching enroll students for class:', classId);
    console.log('🏫 Current admin school:', userSchool);
    console.log('👑 Is super admin:', isSuperAdmin);
    
    // Get class data with teacher info
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                school: true
              }
            }
          }
        },
        enrollments: {
          include: {
            student: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    idNumber: true,
                    school: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!classData) {
      req.flash('error', 'Class not found');
      return res.redirect('/admin/classes');
    }

    // If not superadmin, check if the class's teacher's school matches the current admin's school
    if (!isSuperAdmin && classData.teacher.user.school !== userSchool) {
      req.flash('error', 'You do not have permission to manage students in this class');
      return res.redirect('/admin/classes');
    }

    // Get students who are NOT enrolled in this class
    // Filter by school if not superadmin
    const whereCondition = isSuperAdmin 
      ? {}  // Superadmin can see all students
      : { user: { school: userSchool } };  // Regular admin only sees their school students

    const availableStudents = await prisma.student.findMany({
      where: {
        AND: [
          whereCondition,
          {
            NOT: {
              enrollments: {
                some: {
                  classId: classId
                }
              }
            }
          }
        ]
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            idNumber: true,
            school: true,
            email: true
          }
        }
      },
      orderBy: {
        user: {
          firstName: 'asc'
        }
      }
    });

    // Get enrolled students
    const enrolledStudents = classData.enrollments;

    console.log(`✅ Found ${enrolledStudents.length} enrolled students`);
    console.log(`✅ Found ${availableStudents.length} available students`);

    // Get query parameters for messages
    const success = req.query.success;
    const error = req.query.error;

    // Render the page with data
    res.render('admin/enroll-students', {
      title: `Enroll Students - ${classData.name}`,
      classData,
      enrolledStudents,
      availableStudents,
      currentSchool: userSchool, // Pass current school to frontend
      isSuperAdmin,  // Pass superadmin status
      success,
      error,
      adminInfo: req.user?.admin || null
    });

  } catch (error) {
    console.error('Error loading enroll students page:', error);
    req.flash('error', 'Failed to load student enrollment page');
    res.redirect('/admin/classes');
  }
};

// Enroll students in class - UPDATED with school validation
const enrollStudents = async (req, res) => {
  try {
    const { classId } = req.params;
    const { studentIds } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('📝 Enrolling students in class:', classId);
    console.log('🎯 Student IDs:', studentIds);
    console.log('🏫 Admin school:', userSchool);
    console.log('👑 Is super admin:', isSuperAdmin);

    // Validate studentIds exists and is an array
    if (!studentIds) {
      req.flash('error', 'Please select at least one student to enroll');
      return res.redirect(`/admin/classes/${classId}/enroll`);
    }

    // Handle case where studentIds is a single value (not array)
    const studentIdsArray = Array.isArray(studentIds) ? studentIds : [studentIds];

    if (studentIdsArray.length === 0) {
      req.flash('error', 'Please select at least one student to enroll');
      return res.redirect(`/admin/classes/${classId}/enroll`);
    }

    // Check if class exists and get class data
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: {
            user: {
              select: {
                school: true
              }
            }
          }
        }
      }
    });

    if (!classData) {
      req.flash('error', 'Class not found');
      return res.redirect('/admin/classes');
    }

    // If not superadmin, check if the class's teacher's school matches the current admin's school
    if (!isSuperAdmin && classData.teacher.user.school !== userSchool) {
      req.flash('error', 'You do not have permission to enroll students in this class');
      return res.redirect('/admin/classes');
    }

    // Verify that all students belong to the same school (if not superadmin)
    if (!isSuperAdmin) {
      const students = await prisma.student.findMany({
        where: {
          id: { in: studentIdsArray.map(id => id.trim()) }
        },
        include: {
          user: {
            select: {
              school: true,
              firstName: true,
              lastName: true
            }
          }
        }
      });

      console.log(`🔍 Checking ${students.length} students for school validation`);

      // Check if any students don't belong to the current school
      const invalidStudents = students.filter(student => 
        student.user.school !== userSchool
      );

      if (invalidStudents.length > 0) {
        const invalidNames = invalidStudents.map(s => 
          `${s.user.firstName} ${s.user.lastName} (${s.user.school})`
        ).join(', ');
        
        console.log(`❌ Invalid students found: ${invalidNames}`);
        req.flash('error', `Cannot enroll students from other schools: ${invalidNames}`);
        return res.redirect(`/admin/classes/${classId}/enroll`);
      }
    }

    // Check for duplicate enrollments
    const existingEnrollments = await prisma.enrollment.findMany({
      where: {
        classId: classId,
        studentId: { in: studentIdsArray.map(id => id.trim()) }
      },
      select: {
        student: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    if (existingEnrollments.length > 0) {
      const duplicateNames = existingEnrollments.map(e => 
        `${e.student.user.firstName} ${e.student.user.lastName}`
      ).join(', ');
      
      console.log(`⚠️ Duplicate enrollments found: ${duplicateNames}`);
      req.flash('error', `Some students are already enrolled: ${duplicateNames}`);
      return res.redirect(`/admin/classes/${classId}/enroll`);
    }

    // Create enrollment records
    const enrollments = await Promise.all(
      studentIdsArray.map(async (studentId) => {
        try {
          return await prisma.enrollment.create({
            data: {
              studentId: studentId.trim(),
              classId: classId,
              enrolledAt: new Date()
            }
          });
        } catch (enrollError) {
          console.error(`Error enrolling student ${studentId}:`, enrollError);
          return null;
        }
      })
    );

    // Filter out null values (failed enrollments)
    const successfulEnrollments = enrollments.filter(enrollment => enrollment !== null);
    
    console.log(`✅ Successfully enrolled ${successfulEnrollments.length} students`);

    // Send notifications to students about their enrollment
    for (const studentId of studentIdsArray) {
      try {
        const student = await prisma.student.findUnique({
          where: { id: studentId.trim() },
          include: { user: true }
        });

        if (student && student.user) {
          await prisma.notification.create({
            data: {
              userId: student.user.id,
              title: 'Class Enrollment',
              message: `You have been enrolled in ${classData.name}.`,
              icon: 'fas fa-user-graduate',
              read: false
            }
          });
        }
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
        // Continue even if notification fails
      }
    }

    req.flash('success', `${successfulEnrollments.length} student(s) enrolled successfully in ${classData.name}`);
    return res.redirect(`/admin/classes/${classId}/enroll`);
    
  } catch (error) {
    console.error('Error enrolling students:', error);
    
    // Handle specific error codes
    if (error.code === 'P2002') {
      req.flash('error', 'Duplicate enrollment detected. Some students may already be enrolled in this class.');
    } else if (error.code === 'P2025') {
      req.flash('error', 'One or more students not found in the database');
    } else {
      req.flash('error', 'An error occurred while enrolling students: ' + error.message);
    }
    
    return res.redirect(`/admin/classes/${req.params.classId}/enroll`);
  }
};

// Remove student from class - UPDATED with school validation
const removeStudent = async (req, res) => {
  try {
    const classId = req.params.classId;
    const studentId = req.params.studentId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log(`🗑️ Removing student ${studentId} from class ${classId}`);

    // First, check if the class exists and belongs to the right school
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: {
            user: {
              select: {
                school: true
              }
            }
          }
        }
      }
    });

    if (!classData) {
      req.flash('error', 'Class not found');
      return res.redirect('/admin/classes');
    }

    // If not superadmin, check if the class belongs to the admin's school
    if (!isSuperAdmin && classData.teacher.user.school !== userSchool) {
      req.flash('error', 'You do not have permission to remove students from this class');
      return res.redirect('/admin/classes');
    }

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
      req.flash('error', 'Student not found in this class');
      return res.redirect(`/admin/classes/${classId}/enroll`);
    }

    req.flash('success', 'Student removed successfully');
    res.redirect(`/admin/classes/${classId}/enroll`);
  } catch (error) {
    console.error('Remove student error:', error);
    req.flash('error', 'Error removing student: ' + error.message);
    res.redirect(`/admin/classes/${req.params.classId}/enroll`);
  }
};

// View students in a class - UPDATED with school validation
const viewClassStudents = async (req, res) => {
  try {
    const { classId } = req.params;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log(`👨‍🎓 Viewing students for class: ${classId}`);
    console.log(`🏫 Admin school: ${userSchool}`);
    
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: { 
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                school: true
              }
            }
          }
        },
        enrollments: {
          include: {
            student: {
              include: { 
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    idNumber: true,
                    school: true
                  }
                }
              }
            }
          }
        }
      }
    });
    
    if (!classData) {
      return res.status(404).render('error/404', { 
        title: 'Class Not Found',
        adminInfo: req.user?.admin || null
      });
    }
    
    // If not superadmin, check if the class belongs to the admin's school
    if (!isSuperAdmin && classData.teacher.user.school !== userSchool) {
      req.flash('error', 'You do not have permission to view this class');
      return res.redirect('/admin/classes');
    }
    
    // Filter enrolled students by school if not superadmin
    let filteredEnrollments = classData.enrollments;
    if (!isSuperAdmin) {
      filteredEnrollments = classData.enrollments.filter(enrollment => 
        enrollment.student.user.school === userSchool
      );
    }
    
    console.log(`✅ Found ${filteredEnrollments.length} students in class`);
    
    res.render('admin/class-students', {
      title: `Students in ${classData.name}`,
      classData: {
        ...classData,
        enrollments: filteredEnrollments
      },
      userSchool,
      isSuperAdmin,
      adminInfo: req.user?.admin || null
    });
  } catch (error) {
    console.error('View class students error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null
    });
  }
};

// Also update the manageClasses function to ensure school filtering
const manageClasses = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log(`📚 Managing classes for school: ${userSchool}`);
    console.log(`👑 Is super admin: ${isSuperAdmin}`);
    
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
          include: { 
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                school: true
              }
            }
          }
        },
        enrollments: {
          include: {
            student: {
              include: { 
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    school: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    const teachers = await prisma.teacher.findMany({
      where: teacherWhere,
      include: { 
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            school: true
          }
        }
      },
      orderBy: {
        user: {
          firstName: 'asc'
        }
      }
    });
    
    console.log(`✅ Found ${classes.length} classes`);
    console.log(`✅ Found ${teachers.length} teachers`);
    
    res.render('admin/classes', { 
      title: 'Class Management',
      classes, 
      teachers,
      userSchool,
      isSuperAdmin,
      adminInfo: req.user?.admin || null
    });
  } catch (error) {
    console.error('Manage classes error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null
    });
  }
};

// Update the getClass function for editing
const getClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log(`✏️ Getting class for editing: ${classId}`);
    
    const cls = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: { 
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                school: true
              }
            }
          }
        }
      }
    });
    
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // If not superadmin, check if the class belongs to the admin's school
    if (!isSuperAdmin && cls.teacher.user.school !== userSchool) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have permission to edit this class' 
      });
    }
    
    // Get all teachers for the dropdown (filtered by school if not superadmin)
    let teacherWhere = {};
    if (userSchool && !isSuperAdmin) {
      teacherWhere = {
        user: {
          school: userSchool
        }
      };
    }
    
    const teachers = await prisma.teacher.findMany({
      where: teacherWhere,
      include: { 
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            school: true
          }
        }
      }
    });
    
    console.log(`✅ Found ${teachers.length} teachers for dropdown`);
    
    res.json({ 
      success: true, 
      class: cls, 
      teachers 
    });
  } catch (error) {
    console.error('Get class error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update the updateClass function
const updateClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const { name, grade, section, teacherId } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log(`🔄 Updating class: ${classId}`);
    console.log(`📝 New data:`, { name, grade, section, teacherId });
    
    // Validate required fields
    if (!name || !grade || !section || !teacherId) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    // Check if class exists and get its current data
    const existingClass = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: {
            user: {
              select: {
                school: true
              }
            }
          }
        }
      }
    });
    
    if (!existingClass) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // If not superadmin, check if the class belongs to the admin's school
    if (!isSuperAdmin && existingClass.teacher.user.school !== userSchool) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have permission to update this class' 
      });
    }
    
    // Check if new teacher belongs to the same school (if not superadmin)
    if (!isSuperAdmin) {
      const newTeacher = await prisma.teacher.findUnique({
        where: { id: teacherId },
        include: {
          user: {
            select: {
              school: true
            }
          }
        }
      });
      
      if (!newTeacher) {
        return res.status(404).json({ success: false, message: 'Selected teacher not found' });
      }
      
      if (newTeacher.user.school !== userSchool) {
        return res.status(403).json({ 
          success: false, 
          message: 'Cannot assign a teacher from a different school' 
        });
      }
    }
    
    // Update class
    const updatedClass = await prisma.class.update({
      where: { id: classId },
      data: {
        name,
        grade,
        section,
        teacherId: teacherId
      }
    });
    
    console.log(`✅ Class updated successfully: ${updatedClass.name}`);
    
    res.json({ 
      success: true, 
      message: 'Class updated successfully',
      class: updatedClass
    });
  } catch (error) {
    console.error('Update class error:', error);
    
    if (error.code === 'P2002') {
      return res.status(400).json({ 
        success: false, 
        message: 'A class with similar details already exists' 
      });
    }
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Teacher not found' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred while updating class' 
    });
  }
};

// Update the deleteClass function
const deleteClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log(`🗑️ Deleting class: ${classId}`);
    
    // Check if class exists and get its data
    const existingClass = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: {
            user: {
              select: {
                school: true
              }
            }
          }
        }
      }
    });
    
    if (!existingClass) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // If not superadmin, check if the class belongs to the admin's school
    if (!isSuperAdmin && existingClass.teacher.user.school !== userSchool) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have permission to delete this class' 
      });
    }
    
    // Delete class (Prisma will handle cascading deletes if set up in schema)
    await prisma.class.delete({
      where: { id: classId }
    });
    
    console.log(`✅ Class deleted successfully: ${existingClass.name}`);
    
    res.json({ 
      success: true, 
      message: 'Class deleted successfully',
      className: existingClass.name
    });
  } catch (error) {
    console.error('Delete class error:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Server error occurred while deleting class' 
    });
  }
};

// Get student tuition data - FIXED: Use id instead of userId
const getStudentTuition = async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const student = await prisma.student.findUnique({
      where: { id: studentId },
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

// Update student tuition status - FIXED: Use id instead of userId
const updateStudentTuition = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { tuitionStatus, accessDays, receiptNumber } = req.body;
    
    // Find the student record first
    const student = await prisma.student.findUnique({
      where: { id: studentId }
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    // Set password permissions based on tuition status
    const canChangePassword = tuitionStatus === 'paid';
    const tempPasswordExpiry = tuitionStatus === 'partial' ? calculatePasswordExpiry(parseInt(accessDays) || 30) : null;
    
    // Update student tuition status
    await prisma.student.update({
      where: { id: studentId },
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
            studentId: studentId,
            semester: `${new Date().getFullYear()}-1`
          }
        });
      }
    }
    
    // Update user's temporary password status if tuition is paid
    if (tuitionStatus === 'paid') {
      await prisma.user.update({
        where: { id: student.userId },
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
// Extend access for partial payment students - FIXED: Use id instead of userId
const extendAccess = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { days } = req.body;
    
    const student = await prisma.student.findUnique({
      where: { id: studentId }
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    if (student.tuitionStatus !== 'partial') {
      return res.status(400).json({ success: false, message: 'Can only extend access for partial payment students' });
    }
    
    const newExpiry = calculatePasswordExpiry(parseInt(days) || 30);
    
    await prisma.student.update({
      where: { id: studentId },
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
      schools: schools.filter(s => s.school),
      adminInfo: req.user?.admin || null // FIXED: Added adminInfo
    });
  } catch (error) {
    console.error('Manage schools error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null // FIXED: Added adminInfo to error page
    });
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

// NEW PARENT MANAGEMENT MODULES

// Get student parent data - FIXED: Use id instead of userId
const getStudentParent = async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: true,
        parents: {
          include: {
            parent: {
              include: {
                user: true,
                wallet: {
                  include: {
                    transactions: {
                      orderBy: {
                        createdAt: 'desc'
                      },
                      take: 10
                    }
                  }
                }
              }
            }
          }
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
    console.error('Get student parent error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error: ' + error.message 
    });
  }
};

// Get available parents
const getAvailableParents = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    let whereClause = {
      role: 'parent'
    };
    
    if (!isSuperAdmin && userSchool) {
      whereClause.school = userSchool;
    }
    
    console.log('🔍 Fetching parents with where clause:', whereClause);
    
    const parents = await prisma.user.findMany({
      where: whereClause,
      include: {
        parent: {
          include: {
            students: {
              include: {
                student: true
              }
            },
            wallet: true
          }
        }
      }
    });
    
    console.log('📊 Raw parents data:', JSON.stringify(parents, null, 2));
    
    // Filter and validate parent data
    const validParents = parents.filter(parent => {
      if (!parent || !parent.id) {
        console.log('❌ Invalid parent: missing parent or parent.id', parent);
        return false;
      }
      if (!parent.firstName || !parent.lastName) {
        console.log('❌ Invalid parent: missing name fields', parent);
        return false;
      }
      return true;
    });
    
    console.log(`✅ Valid parents: ${validParents.length}/${parents.length}`);
    
    res.json({
      success: true,
      parents: validParents,
      total: parents.length,
      valid: validParents.length
    });
  } catch (error) {
    console.error('Get available parents error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Link existing parent to student - FIXED: Remove parseInt
const linkExistingParent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { parentId, relationship } = req.body;
    
    const student = await prisma.student.findUnique({
      where: { id: studentId }
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    const parent = await prisma.parent.findUnique({
      where: { userId: parentId }
    });
    
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent not found' });
    }
    
    // Check if already linked
    const existingLink = await prisma.studentParent.findUnique({
      where: {
        parentId_studentId: {
          parentId: parent.id,
          studentId: student.id
        }
      }
    });
    
    if (existingLink) {
      return res.status(400).json({ success: false, message: 'Parent is already linked to this student' });
    }
    
    // Create the link
    await prisma.studentParent.create({
      data: {
        parentId: parent.id,
        studentId: student.id,
        relationship: relationship || 'parent'
      }
    });
    
    res.json({
      success: true,
      message: 'Parent linked to student successfully'
    });
  } catch (error) {
    console.error('Link existing parent error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Create new parent and link to student - FIXED: Remove parseInt
const createNewParent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { firstName, lastName, email, relationship } = req.body;
    
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { user: true }
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    // Generate parent ID
    const parentIdNumber = await generateParentId();
    
    // Create parent user
    const parentUser = await prisma.user.create({
      data: {
        idNumber: parentIdNumber,
        password: await hashPassword('12345'),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email ? email.trim() : null,
        role: 'parent',
        isTemporaryPassword: true,
        school: student.user.school,
        isActive: true
      }
    });
    
    // Create parent record
    const parent = await prisma.parent.create({
      data: {
        userId: parentUser.id
      }
    });
    
    // Create wallet for parent
    await prisma.wallet.create({
      data: {
        parentId: parent.id,
        balance: 0
      }
    });
    
    // Link parent to student
    await prisma.studentParent.create({
      data: {
        parentId: parent.id,
        studentId: student.id,
        relationship: relationship || 'parent'
      }
    });
    
    res.json({
      success: true,
      message: `Parent created and linked successfully. Parent ID: ${parentIdNumber}, Password: 12345`,
      parentId: parentUser.id
    });
  } catch (error) {
    console.error('Create new parent error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Unlink parent from student - FIXED: Remove parseInt
const unlinkParent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { parentId } = req.body;
    
    const student = await prisma.student.findUnique({
      where: { id: studentId }
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    const parent = await prisma.parent.findUnique({
      where: { userId: parentId }
    });
    
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent not found' });
    }
    
    // Remove the link
    await prisma.studentParent.delete({
      where: {
        parentId_studentId: {
          parentId: parent.id,
          studentId: student.id
        }
      }
    });
    
    res.json({
      success: true,
      message: 'Parent unlinked from student successfully'
    });
  } catch (error) {
    console.error('Unlink parent error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get parent account details - FIXED: Remove parseInt
const getParentAccount = async (req, res) => {
  try {
    const { parentId } = req.params;
    
    const parent = await prisma.parent.findUnique({
      where: { userId: parentId },
      include: {
        user: true,
        wallet: {
          include: {
            transactions: {
              orderBy: {
                createdAt: 'desc'
              },
              take: 10
            }
          }
        },
        students: {
          include: {
            student: {
              include: {
                user: true
              }
            }
          }
        }
      }
    });
    
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent not found' });
    }
    
    res.json({
      success: true,
      parent: parent
    });
  } catch (error) {
    console.error('Get parent account error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Add funds to parent wallet - FIXED: Remove parseInt
const addWalletFunds = async (req, res) => {
  try {
    const { parentId } = req.params;
    const { amount, description } = req.body;
    
    const parent = await prisma.parent.findUnique({
      where: { userId: parentId },
      include: { wallet: true }
    });
    
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent not found' });
    }
    
    if (!parent.wallet) {
      // Create wallet if it doesn't exist
      await prisma.wallet.create({
        data: {
          parentId: parent.id,
          balance: parseFloat(amount)
        }
      });
    } else {
      // Update wallet balance
      await prisma.wallet.update({
        where: { parentId: parent.id },
        data: {
          balance: parent.wallet.balance + parseFloat(amount)
        }
      });
    }
    
    // Create transaction record
    await prisma.transaction.create({
      data: {
        walletId: parent.wallet ? parent.wallet.id : (await prisma.wallet.findUnique({ where: { parentId: parent.id } })).id,
        amount: parseFloat(amount),
        type: 'deposit',
        description: description || 'Admin deposit',
        status: 'completed'
      }
    });
    
    res.json({
      success: true,
      message: `=N=${amount} added to parent wallet successfully`
    });
  } catch (error) {
    console.error('Add wallet funds error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Unlink student from parent - FIXED: Remove parseInt
const unlinkStudent = async (req, res) => {
  try {
    const { parentId } = req.params;
    const { studentId } = req.body;
    
    const parent = await prisma.parent.findUnique({
      where: { userId: parentId }
    });
    
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent not found' });
    }
    
    const student = await prisma.student.findUnique({
      where: { id: studentId }
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    // Remove the link
    await prisma.studentParent.delete({
      where: {
        parentId_studentId: {
          parentId: parent.id,
          studentId: student.id
        }
      }
    });
    
    res.json({
      success: true,
      message: 'Student unlinked from parent successfully'
    });
  } catch (error) {
    console.error('Unlink student error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get student parent information for the parent info modal - FIXED: Use id instead of userId
const getStudentParentInfo = async (req, res) => {
  try {
    const { studentId } = req.params;
    
    console.log('🔍 Fetching parent info for student:', studentId);
    
    const student = await prisma.student.findUnique({
      where: { id: studentId },
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
        parents: {
          include: {
            parent: {
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
                wallet: {
                  include: {
                    transactions: {
                      orderBy: {
                        createdAt: 'desc'
                      },
                      take: 5
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    
    if (!student) {
      console.log('❌ Student not found:', studentId);
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    console.log('✅ Found student with parents:', student.parents?.length || 0);
    
    // Log the parent data to debug the createdAt issue
    if (student.parents && student.parents.length > 0) {
      student.parents.forEach((parentRelation, index) => {
        console.log(`👨‍👧‍👦 Parent ${index + 1}:`, {
          parentId: parentRelation.parent?.user?.id,
          parentName: parentRelation.parent?.user?.firstName + ' ' + parentRelation.parent?.user?.lastName,
          relationship: parentRelation.relationship,
          createdAt: parentRelation.createdAt,
          hasCreatedAt: !!parentRelation.createdAt
        });
      });
    }
    
    res.json({
      success: true,
      student: student
    });
  } catch (error) {
    console.error('💥 Get student parent info error:', error);
    res.status(500).json({ success: false, message: 'Server error occurred while loading parent information' });
  }
};

// // Add this function to your adminController - FIXED: Remove parseInt
// const getClassStudents = async (req, res) => {
//   try {
//     const { classId } = req.params;
    
//     const classData = await prisma.class.findUnique({
//       where: { id: classId },
//       include: {
//         teacher: {
//           include: { user: true }
//         },
//         enrollments: {
//           include: {
//             student: {
//               include: { 
//                 user: true,
//                 parents: {
//                   include: {
//                     parent: {
//                       include: { user: true }
//                     }
//                   }
//                 }
//               }
//             }
//           }
//         }
//       }
//     });
    
//     if (!classData) {
//       return res.status(404).json({ success: false, message: 'Class not found' });
//     }
    
//     res.json({
//       success: true,
//       class: classData,
//       students: classData.enrollments.map(enrollment => enrollment.student)
//     });
//   } catch (error) {
//     console.error('Get class students error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

// Add placeholder functions for financial transactions (to be implemented)
const getFinancialTransactions = async (req, res) => {
  try {
    res.json({ success: true, transactions: [] });
  } catch (error) {
    console.error('Get financial transactions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const createFinancialTransaction = async (req, res) => {
  try {
    res.json({ success: true, message: 'Transaction created successfully' });
  } catch (error) {
    console.error('Create financial transaction error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getFinancialDashboard = async (req, res) => {
  try {
    res.json({ success: true, dashboard: {} });
  } catch (error) {
    console.error('Get financial dashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteFinancialTransaction = async (req, res) => {
  try {
    res.json({ success: true, message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete financial transaction error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// Get savings goal by ID for admin
const getSavingsGoal = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log('🔍 Admin fetching savings goal:', id);
        
        const goal = await prisma.savingsGoal.findUnique({
            where: { id: id },
            include: {
                parent: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                email: true,
                                idNumber: true
                            }
                        }
                    }
                },
                deposits: {
                    orderBy: { createdAt: 'desc' },
                    take: 10
                }
            }
        });
        
        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Savings goal not found'
            });
        }
        
        const progress = goal.targetAmount > 0 
            ? (goal.currentAmount / goal.targetAmount) * 100 
            : 0;
        
        const response = {
            ...goal,
            progress: progress.toFixed(1),
            remainingAmount: goal.targetAmount - goal.currentAmount,
            isCompleted: goal.currentAmount >= goal.targetAmount,
            canTransfer: goal.currentAmount > 0 && goal.isActive
        };
        
        console.log('✅ Found savings goal:', goal.name);
        
        res.json({
            success: true,
            goal: response
        });
        
    } catch (error) {
        console.error('❌ Error fetching savings goal:', error);
        
        if (error.code === 'P2023') {
            return res.status(400).json({
                success: false,
                message: 'Invalid savings goal ID format'
            });
        }
        
        if (error.code === 'P2025') {
            return res.status(404).json({
                success: false,
                message: 'Savings goal not found'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Server error while fetching savings goal'
        });
    }
};

// Add this function for getClassStudents
const getClassStudents = async (req, res) => {
    try {
        const { classId } = req.params;
        
        console.log('👨‍🎓 Fetching students for class:', classId);
        
        const classData = await prisma.class.findUnique({
            where: { id: classId },
            include: {
                teacher: {
                    include: { user: true }
                },
                enrollments: {
                    include: {
                        student: {
                            include: { 
                                user: true,
                                parents: {
                                    include: {
                                        parent: {
                                            include: { user: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        
        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }
        
        const students = classData.enrollments.map(enrollment => enrollment.student);
        
        console.log(`✅ Found ${students.length} students in class`);
        
        res.json({
            success: true,
            class: {
                id: classData.id,
                name: classData.name,
                grade: classData.grade,
                section: classData.section,
                teacher: classData.teacher?.user
            },
            students: students
        });
        
    } catch (error) {
        console.error('❌ Get class students error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// Also add this for savings goals
const getAllSavingsGoals = async (req, res) => {
    try {
        const goals = await prisma.savingsGoal.findMany({
            include: {
                parent: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true,
                                idNumber: true
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        
        const goalsWithProgress = goals.map(goal => {
            const progress = goal.targetAmount > 0 
                ? (goal.currentAmount / goal.targetAmount) * 100 
                : 0;
            
            return {
                ...goal,
                progress: progress.toFixed(1),
                remainingAmount: goal.targetAmount - goal.currentAmount,
                isCompleted: goal.currentAmount >= goal.targetAmount
            };
        });
        
        res.json({
            success: true,
            goals: goalsWithProgress,
            total: goals.length
        });
        
    } catch (error) {
        console.error('Error fetching all savings goals:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

const getTuitionAnalytics = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('💰 Fetching tuition analytics for:', userSchool);

    // Build where clause for school filtering
    let whereClause = {};
    if (userSchool && !isSuperAdmin) {
      whereClause = {
        user: {
          school: userSchool
        }
      };
    }

    const students = await prisma.student.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            isActive: true
          }
        }
      }
    });

    const paidStudents = students.filter(s => s.tuitionStatus === 'paid').length;
    const partialStudents = students.filter(s => s.tuitionStatus === 'partial').length;
    const unpaidStudents = students.filter(s => s.tuitionStatus === 'unpaid').length;

    // Calculate expired partial payments
    const now = new Date();
    const expiredStudents = students.filter(s => 
      s.tuitionStatus === 'partial' && 
      s.tempPasswordExpiry && 
      new Date(s.tempPasswordExpiry) < now
    ).length;

    res.json({
      success: true,
      paidStudents,
      partialStudents,
      unpaidStudents,
      expiredStudents,
      totalStudents: students.length,
      collectionRate: students.length > 0 ? 
        Math.round((paidStudents / students.length) * 100) : 0
    });
  } catch (error) {
    console.error('Tuition analytics error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
};

// Update getAnalyticsData function to include school filtering
const getAnalyticsData = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('📊 Fetching analytics data for:', userSchool);

    // Build where clauses for school filtering
    let studentWhere = {};
    let teacherWhere = {};
    let adminWhere = {};
    let classWhere = {};
    let assignmentWhere = {};
    let materialWhere = {};
    let submissionWhere = {};
    let parentWhere = {};
    let userWhere = {};

    if (userSchool && !isSuperAdmin) {
      studentWhere = { user: { school: userSchool } };
      teacherWhere = { user: { school: userSchool } };
      adminWhere = { user: { school: userSchool } };
      classWhere = { teacher: { user: { school: userSchool } } };
      assignmentWhere = { teacher: { user: { school: userSchool } } };
      materialWhere = { teacher: { user: { school: userSchool } } };
      submissionWhere = { student: { user: { school: userSchool } } };
      parentWhere = { user: { school: userSchool } };
      userWhere = { school: userSchool };
    }

    // Get statistics with school filtering
    const [
      totalStudents,
      totalTeachers,
      totalAdmins,
      totalClasses,
      totalAssignments,
      totalParents,
      parentsWithWallet
    ] = await Promise.all([
      prisma.student.count({ where: studentWhere }),
      prisma.teacher.count({ where: teacherWhere }),
      prisma.admin.count({ where: adminWhere }),
      prisma.class.count({ where: classWhere }),
      prisma.assignment.count({ where: assignmentWhere }),
      prisma.parent.count({ where: parentWhere }),
      prisma.parent.count({
        where: {
          ...parentWhere,
          wallet: { isNot: null }
        }
      })
    ]);

    // Get total subjects
    const teacherSubjects = await prisma.teacher.findMany({
      where: teacherWhere,
      select: { subject: true }
    });
    const totalSubjects = [...new Set(teacherSubjects.map(t => t.subject))].length;

    // Get activity data (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [recentMaterials, recentAssignments, recentSubmissions] = await Promise.all([
      prisma.material.count({
        where: { 
          createdAt: { gte: thirtyDaysAgo },
          ...materialWhere
        }
      }),
      prisma.assignment.count({
        where: { 
          createdAt: { gte: thirtyDaysAgo },
          ...assignmentWhere
        }
      }),
      prisma.submission.count({
        where: { 
          submittedAt: { gte: thirtyDaysAgo },
          ...submissionWhere
        }
      })
    ]);

    // Get active users - FIXED: removed lastLoginAt
    const [activeStudents, activeTeachers] = await Promise.all([
      prisma.user.count({
        where: {
          role: 'student',
          ...userWhere,
          isActive: true
        }
      }),
      prisma.user.count({
        where: {
          role: 'teacher',
          ...userWhere,
          isActive: true
        }
      })
    ]);

    res.json({
      success: true,
      totalStudents,
      totalTeachers,
      totalAdmins,
      totalClasses,
      totalAssignments,
      totalSubjects,
      totalParents,
      parentsWithWallet,
      recentMaterials,
      recentAssignments,
      recentSubmissions,
      totalActiveStudents: activeStudents,
      totalActiveTeachers: activeTeachers,
      currentUserSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Analytics data error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch analytics data',
      error: error.message 
    });
  }
};

// Update getGradesData with school filtering
const getGradesData = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        let whereClause = {};
        if (userSchool && !isSuperAdmin) {
            whereClause = {
                student: {
                    user: {
                        school: userSchool
                    }
                }
            };
        }

        // Get grade distribution
        const submissions = await prisma.submission.findMany({
            where: {
                grade: { not: null },
                ...whereClause
            },
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

        res.json({ 
            success: true,
            distribution,
            totalSubmissions: grades.length,
            averageGrade: grades.length > 0 ? 
                (grades.reduce((sum, grade) => sum + grade, 0) / grades.length).toFixed(1) : 0
        });
    } catch (error) {
        console.error('Grades data error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch grades data' });
    }
};

// Update getActivitiesData with school filtering
const getActivitiesData = async (req, res) => {
    try {
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;
        
        let whereClause = {};
        if (userSchool && !isSuperAdmin) {
            whereClause = {
                school: userSchool
            };
        }

        // Get recent user activities (last 20 created users)
        const recentActivities = await prisma.user.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: {
                student: true,
                teacher: true,
                admin: true,
                parent: true
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
            activityType: "account_created",
            school: activity.school
        }));

        res.json({
            success: true,
            activities: formattedActivities,
            total: formattedActivities.length
        });
    } catch (error) {
        console.error('Activities data error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch activities data' });
    }
};

// NEW: System reset page
const systemResetPage = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Get school statistics
    let whereClause = {};
    if (userSchool && !isSuperAdmin) {
      whereClause = { school: userSchool };
    }

    // Get student count
    const studentCount = await prisma.user.count({
      where: {
        ...whereClause,
        role: 'student'
      }
    });

    // Get parent count
    const parentCount = await prisma.user.count({
      where: {
        ...whereClause,
        role: 'parent'
      }
    });

    // Get teacher count
    const teacherCount = await prisma.user.count({
      where: {
        ...whereClause,
        role: 'teacher'
      }
    });

    // Get payment statistics
    const students = await prisma.student.findMany({
      where: userSchool && !isSuperAdmin ? {
        user: { school: userSchool }
      } : {},
      select: {
        tuitionStatus: true
      }
    });

    const paidCount = students.filter(s => s.tuitionStatus === 'paid').length;
    const unpaidCount = students.filter(s => s.tuitionStatus === 'unpaid').length;
    const partialCount = students.filter(s => s.tuitionStatus === 'partial').length;

    res.render('admin/system-reset', {
      title: 'System Reset & Maintenance',
      userSchool,
      isSuperAdmin,
      adminInfo: req.user?.admin || null,
      statistics: {
        totalStudents: studentCount,
        totalParents: parentCount,
        totalTeachers: teacherCount,
        paidStudents: paidCount,
        unpaidStudents: unpaidCount,
        partialStudents: partialCount
      }
    });
  } catch (error) {
    console.error('System reset page error:', error);
    res.status(500).render('error/500', {
      title: 'Server Error',
      adminInfo: req.user?.admin || null
    });
  }
};

// NEW: Reset all payments to unpaid
const resetAllPayments = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    const { confirmation, resetType } = req.body;
    
    if (confirmation !== 'CONFIRM') {
      return res.status(400).json({
        success: false,
        message: 'Please type CONFIRM to proceed'
      });
    }

    // Build where clause
    let whereClause = {};
    if (userSchool && !isSuperAdmin) {
      whereClause = {
        user: { school: userSchool }
      };
    }

    // Get all students
    const students = await prisma.student.findMany({
      where: whereClause,
      include: { user: true }
    });

    let updatedCount = 0;
    
    // Update each student's payment status
    for (const student of students) {
      await prisma.student.update({
        where: { id: student.id },
        data: {
          tuitionStatus: resetType === 'partial' ? 'partial' : 'unpaid',
          canChangePassword: false,
          tempPasswordExpiry: resetType === 'partial' ? calculatePasswordExpiry(30) : null
        }
      });

      // Also update user temporary password status
      await prisma.user.update({
        where: { id: student.userId },
        data: {
          isTemporaryPassword: true
        }
      });

      updatedCount++;
    }

    // Log the activity (handle case where ActivityLog doesn't exist)
    try {
      if (prisma.activityLog) {
        await prisma.activityLog.create({
          data: {
            userId: req.session.user.id,
            action: `reset_${resetType}_payments`,
            description: `Reset ${updatedCount} student payments to ${resetType} status`,
            ipAddress: req.ip || 'unknown'
          }
        });
      }
    } catch (logError) {
      console.log('ActivityLog not available, skipping logging');
    }

    res.json({
      success: true,
      message: `Successfully reset ${updatedCount} student payments to ${resetType.toUpperCase()} status`,
      count: updatedCount
    });

  } catch (error) {
    console.error('Reset all payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset payments: ' + error.message
    });
  }
};

// Delete selected users - UPDATED
const deleteSelectedUsers = async (req, res) => {
  try {
    const { userIds, userType, confirmation } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    if (confirmation !== 'DELETE') {
      return res.status(400).json({
        success: false,
        message: 'Please type DELETE to confirm deletion'
      });
    }

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No users selected for deletion'
      });
    }

    // Build base where clause
    let baseWhere = { id: { in: userIds } };
    
    // Add school filter for non-super admins
    if (userSchool && !isSuperAdmin) {
      baseWhere.school = userSchool;
    }

    // Filter by user type if specified
    if (userType && userType !== 'all') {
      baseWhere.role = userType;
    }

    // First, get the users to delete (for logging)
    const usersToDelete = await prisma.user.findMany({
      where: baseWhere,
      select: {
        id: true,
        idNumber: true,
        firstName: true,
        lastName: true,
        role: true,
        school: true
      }
    });

    if (usersToDelete.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matching users found to delete'
      });
    }

    let deletedCount = 0;
    let errors = [];
    
    // Delete users one by one (Prisma will handle cascading deletes)
    for (const user of usersToDelete) {
      try {
        await prisma.user.delete({
          where: { id: user.id }
        });
        deletedCount++;
        
        // Log individual deletion if ActivityLog exists
        try {
          if (prisma.activityLog) {
            await prisma.activityLog.create({
              data: {
                userId: req.session.user.id,
                action: 'delete_user',
                description: `Deleted user ${user.idNumber} (${user.firstName} ${user.lastName})`,
                ipAddress: req.ip || 'unknown'
              }
            });
          }
        } catch (logError) {
          console.log('Could not log deletion to ActivityLog');
        }
        
      } catch (deleteError) {
        console.error(`Error deleting user ${user.id}:`, deleteError);
        errors.push(`Failed to delete user ${user.idNumber}: ${deleteError.message}`);
      }
    }

    // Log the bulk operation if ActivityLog exists
    try {
      if (prisma.activityLog && deletedCount > 0) {
        await prisma.activityLog.create({
          data: {
            userId: req.session.user.id,
            action: 'bulk_delete_users',
            description: `Deleted ${deletedCount} users of type ${userType || 'all'}`,
            ipAddress: req.ip || 'unknown'
          }
        });
      }
    } catch (logError) {
      console.log('Could not log bulk operation to ActivityLog');
    }

    const response = {
      success: true,
      message: `Successfully deleted ${deletedCount} users`,
      count: deletedCount,
      failed: usersToDelete.length - deletedCount
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    res.json(response);

  } catch (error) {
    console.error('Delete selected users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete users: ' + error.message
    });
  }
};


// NEW: Reset for new term/section
const resetNewTerm = async (req, res) => {
  try {
    const { term, section, year, confirmation } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    if (confirmation !== 'RESET') {
      return res.status(400).json({
        success: false,
        message: 'Please type RESET to confirm new term reset'
      });
    }

    // Build where clause
    let whereClause = {};
    if (userSchool && !isSuperAdmin) {
      whereClause = { school: userSchool };
    }

    // Get all users for the school
    const users = await prisma.user.findMany({
      where: {
        ...whereClause,
        role: { in: ['student', 'teacher', 'parent'] }
      },
      include: {
        student: true,
        teacher: true
      }
    });

    let updatedCount = 0;
    let operations = [];

    for (const user of users) {
      if (user.role === 'student' && user.student) {
        // Reset student for new term
        operations.push(
          prisma.student.update({
            where: { id: user.student.id },
            data: {
              tuitionStatus: 'unpaid',
              canChangePassword: false,
              tempPasswordExpiry: null,
              grade: section ? parseInt(section) : user.student.grade,
              section: term || user.student.section
            }
          })
        );

        operations.push(
          prisma.user.update({
            where: { id: user.id },
            data: {
              isTemporaryPassword: true
            }
          })
        );

        updatedCount++;
      } else if (user.role === 'teacher' && user.teacher) {
        // Update teacher for new term (if needed)
        operations.push(
          prisma.teacher.update({
            where: { id: user.teacher.id },
            data: {
              // Add any teacher-specific term reset logic here
              updatedAt: new Date()
            }
          })
        );
        updatedCount++;
      }
    }

    // Execute all updates
    await Promise.all(operations);

    // Log the term reset
    await prisma.activityLog.create({
      data: {
        userId: req.session.user.id,
        action: 'new_term_reset',
        description: `Reset ${updatedCount} users for ${term || 'new term'} ${section || ''} ${year || new Date().getFullYear()}`,
        ipAddress: req.ip
      }
    });

    res.json({
      success: true,
      message: `Successfully reset ${updatedCount} users for new term/section`,
      count: updatedCount,
      termDetails: {
        term,
        section,
        year: year || new Date().getFullYear()
      }
    });

  } catch (error) {
    console.error('Reset new term error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset for new term: ' + error.message
    });
  }
};

// In parentController.js 

// Process payment with proper wallet handling
const processPayment = async (req, res) => {
  try {
    const { studentId, amount, paymentMethod, description } = req.body;
    const userId = req.session.user.id;
    
    console.log('💰 Processing payment:', {
      studentId, 
      amount, 
      paymentMethod, 
      userId
    });
    
    // Get parent with wallet
    const parent = await prisma.parent.findFirst({
      where: { userId },
      include: {
        wallet: true
      }
    });
    
    if (!parent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Parent not found' 
      });
    }
    
    // Check if wallet exists
    let wallet = parent.wallet;
    if (!wallet) {
      // Create wallet if it doesn't exist
      wallet = await prisma.wallet.create({
        data: {
          parentId: parent.id,
          balance: 0
        }
      });
    }
    
    console.log('💳 Current wallet balance:', wallet.balance);
    
    // Check if using wallet payment and has sufficient funds
    if (paymentMethod === 'wallet') {
      const paymentAmount = parseFloat(amount);
      
      if (wallet.balance < paymentAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Current: ₦${wallet.balance.toFixed(2)}, Required: ₦${paymentAmount.toFixed(2)}`
        });
      }
      
      // Use Prisma transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Create payment record
        const payment = await tx.payment.create({
          data: {
            receiptNumber: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            amount: paymentAmount,
            status: 'pending',
            studentId: studentId,
            parentId: parent.id,
            paymentMethod: paymentMethod,
            description: description || 'Tuition Payment',
            createdAt: new Date()
          }
        });
        
        // Update wallet balance with DECREMENT
        const updatedWallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: {
              decrement: paymentAmount
            }
          }
        });
        
        // Create wallet transaction
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount: paymentAmount,
            type: 'payment',
            description: `Payment for student - ${description || 'tuition'}`,
            status: 'completed',
            balanceAfter: updatedWallet.balance
          }
        });
        
        return { payment, updatedWallet };
      });
      
      console.log('✅ Payment processed successfully. New balance:', result.updatedWallet.balance);
      
      return res.json({
        success: true,
        message: 'Payment processed successfully!',
        receiptNumber: result.payment.receiptNumber,
        newBalance: result.updatedWallet.balance,
        paymentId: result.payment.id
      });
      
    } else {
      // For other payment methods, just create payment record
      const payment = await prisma.payment.create({
        data: {
          receiptNumber: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          amount: parseFloat(amount),
          status: 'pending',
          studentId: studentId,
          parentId: parent.id,
          paymentMethod: paymentMethod,
          description: description || 'Tuition Payment',
          createdAt: new Date()
        }
      });
      
      return res.json({
        success: true,
        message: 'Payment submitted for processing',
        receiptNumber: payment.receiptNumber,
        paymentId: payment.id
      });
    }
    
  } catch (error) {
    console.error('❌ Payment processing error:', error);
    
    // Check for specific database errors
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Duplicate transaction detected. Please try again.'
      });
    }
    
    if (error.code === 'P2003') {
      return res.status(400).json({
        success: false,
        message: 'Invalid student or parent reference.'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'An error occurred while processing payment'
    });
  }
};

// Add funds to wallet with proper balance tracking
// Add funds to wallet - FIXED VERSION
const addFundsToWallet = async (req, res) => {
  try {
    const { amount, paymentMethod } = req.body;
    const userId = req.session.user.id;
    
    const parent = await prisma.parent.findFirst({
      where: { userId },
      include: {
        wallet: true
      }
    });
    
    if (!parent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Parent not found' 
      });
    }
    
    let wallet = parent.wallet;
    const depositAmount = parseFloat(amount);
    
    // Use transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      if (!wallet) {
        // Create wallet if it doesn't exist
        wallet = await tx.wallet.create({
          data: {
            parentId: parent.id,
            balance: depositAmount
          }
        });
      } else {
        // Update wallet balance with INCREMENT
        wallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: {
              increment: depositAmount
            }
          }
        });
      }
      
      // Create wallet transaction
      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: depositAmount,
          type: 'deposit',
          description: `Deposit via ${paymentMethod}`,
          status: 'completed',
          balanceAfter: wallet.balance
        }
      });
      
      return { wallet, transaction };
    });
    
    console.log('💵 Funds added successfully. New balance:', result.wallet.balance);
    
    return res.json({
      success: true,
      message: `₦${depositAmount.toFixed(2)} added to wallet successfully!`,
      balance: result.wallet.balance,
      transactionId: result.transaction.id
    });
    
  } catch (error) {
    console.error('Add funds error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add funds to wallet: ' + error.message
    });
  }
};

// Get wallet balance with verification
const getWalletBalance = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    const parent = await prisma.parent.findFirst({
      where: { userId },
      include: {
        wallet: true
      }
    });
    
    if (!parent || !parent.wallet) {
      return res.json({
        success: true,
        balance: 0,
        walletExists: !!parent?.wallet
      });
    }
    
    // Verify balance by calculating from transactions
    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: parent.wallet.id },
      select: { amount: true, type: true }
    });
    
    const calculatedBalance = transactions.reduce((total, t) => {
      if (t.type === 'deposit' || t.type === 'refund') {
        return total + t.amount;
      } else if (t.type === 'payment' || t.type === 'withdrawal') {
        return total - t.amount;
      }
      return total;
    }, 0);
    
    const discrepancy = Math.abs(parent.wallet.balance - calculatedBalance);
    
    // If there's a significant discrepancy, log it
    if (discrepancy > 0.01) {
      console.warn('⚠️ Wallet balance discrepancy detected:', {
        walletId: parent.wallet.id,
        storedBalance: parent.wallet.balance,
        calculatedBalance: calculatedBalance,
        discrepancy: discrepancy
      });
      
      // Optional: Fix the discrepancy
      if (discrepancy > 1.00) {
        await prisma.wallet.update({
          where: { id: parent.wallet.id },
          data: { balance: calculatedBalance }
        });
        console.log('🔄 Fixed wallet balance discrepancy');
      }
    }
    
    return res.json({
      success: true,
      balance: parent.wallet.balance,
      calculatedBalance: calculatedBalance,
      discrepancy: discrepancy,
      transactionCount: transactions.length
    });
    
  } catch (error) {
    console.error('Get wallet balance error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get wallet balance'
    });
  }
};

// In parentController.js - Progress reports function
exports.getProgressReports = async (req, res) => {
  try {
    const userId = req.session.user.id;
    console.log('📊 Loading progress reports for parent:', userId);
    
    const parent = await prisma.parent.findFirst({
      where: { userId },
      include: {
        user: true,
        students: {
          include: {
            student: {
              include: {
                user: true,
                classes: {
                  include: {
                    class: {
                      include: {
                        teacher: {
                          include: {
                            user: true  // CRITICAL: Include teacher's user data
                          }
                        },
                        subject: true
                      }
                    }
                  }
                },
                grades: {
                  include: {
                    subject: true,
                    class: {
                      include: {
                        teacher: {
                          include: {
                            user: true
                          }
                        }
                      }
                    }
                  },
                  orderBy: { createdAt: 'desc' }
                }
              }
            }
          }
        }
      }
    });

    if (!parent) {
      console.log('❌ Parent not found for user:', userId);
      return res.render('parent/progress-reports', {
        title: 'Progress Reports',
        user: req.session.user,
        students: [],
        messages: { error: 'Parent record not found' }
      });
    }

    console.log(`✅ Found parent with ${parent.students.length} students`);
    
    // Process each student's data
    const studentsWithProgress = await Promise.all(parent.students.map(async (studentRel) => {
      const student = studentRel.student;
      
      // Calculate attendance stats
      const attendanceRecords = await prisma.attendance.findMany({
        where: { studentId: student.id },
        select: { status: true }
      });
      
      const totalClasses = attendanceRecords.length;
      const presentCount = attendanceRecords.filter(a => a.status === 'present').length;
      const absentCount = attendanceRecords.filter(a => a.status === 'absent').length;
      const lateCount = attendanceRecords.filter(a => a.status === 'late').length;
      
      // Calculate grades
      const grades = student.grades || [];
      const totalGrade = grades.reduce((sum, grade) => sum + grade.grade, 0);
      const averageGrade = grades.length > 0 ? totalGrade / grades.length : 0;
      
      // Get assignments
      const assignments = grades.map(grade => ({
        title: grade.subject?.name || 'Assignment',
        date: grade.createdAt,
        grade: grade.grade,
        feedback: grade.comments || ''
      }));
      
      return {
        student: student,
        progress: {
          overall: averageGrade,
          averageGrade: averageGrade.toFixed(1),
          attendance: {
            rate: totalClasses > 0 ? Math.round((presentCount / totalClasses) * 100) : 0,
            present: totalClasses > 0 ? Math.round((presentCount / totalClasses) * 100) : 0,
            absent: totalClasses > 0 ? Math.round((absentCount / totalClasses) * 100) : 0,
            late: totalClasses > 0 ? Math.round((lateCount / totalClasses) * 100) : 0
          },
          assignments: assignments,
          exams: [], // You can add exam logic here
          classWork: [], // You can add class work logic here
          classes: student.classes ? student.classes.map(c => ({
            id: c.class.id,
            name: c.class.name,
            grade: c.class.grade,
            section: c.class.section,
            teacher: c.class.teacher ? {
              id: c.class.teacher.id,
              user: c.class.teacher.user ? {
                id: c.class.teacher.user.id,
                firstName: c.class.teacher.user.firstName || 'Teacher',
                lastName: c.class.teacher.user.lastName || ''
              } : null
            } : null
          })) : []
        }
      };
    }));

    res.render('parent/progress-reports', {
      title: 'Progress Reports',
      user: req.session.user,
      parent: parent,
      students: studentsWithProgress,
      messages: req.flash()
    });
    
  } catch (error) {
    console.error('💥 Progress reports error:', error);
    console.error('Error stack:', error.stack);
    
    // Send a more detailed error for debugging
    res.status(500).render('error/500', {
      title: 'Server Error',
      error: 'Failed to load progress reports',
      details: error.message
    });
  }
};

// Verify wallet balance against transactions
const verifyWalletBalance = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    const parent = await prisma.parent.findFirst({
      where: { userId },
      include: {
        wallet: {
          include: {
            transactions: true
          }
        }
      }
    });
    
    if (!parent || !parent.wallet) {
      return res.json({
        success: true,
        message: 'No wallet found',
        balance: 0
      });
    }
    
    // Calculate balance from transactions
    const calculatedBalance = parent.wallet.transactions.reduce((total, t) => {
      if (t.type === 'deposit' || t.type === 'refund' || t.type === 'savings_transfer') {
        return total + t.amount;
      } else if (t.type === 'payment' || t.type === 'withdrawal' || t.type === 'savings_deposit') {
        return total - t.amount;
      }
      return total;
    }, 0);
    
    const storedBalance = parent.wallet.balance;
    const discrepancy = Math.abs(storedBalance - calculatedBalance);
    
    // Fix discrepancy if found
    if (discrepancy > 0.01) {
      await prisma.wallet.update({
        where: { id: parent.wallet.id },
        data: { balance: calculatedBalance }
      });
      
      console.log(`🔄 Fixed wallet balance discrepancy: ${discrepancy}`);
    }
    
    return res.json({
      success: true,
      storedBalance: storedBalance,
      calculatedBalance: calculatedBalance,
      discrepancy: discrepancy,
      fixed: discrepancy > 0.01,
      message: discrepancy > 0.01 ? `Wallet balance corrected by ₦${discrepancy.toFixed(2)}` : 'Wallet balance is accurate'
    });
    
  } catch (error) {
    console.error('Verify wallet error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify wallet: ' + error.message
    });
  }
};

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
  checkIdNumber,
  
  // ADD THESE NEW FUNCTIONS:
  getClassStudents,        // Add this
  getSavingsGoal,          // Add this
  getAllSavingsGoals,      // Add this
  
  // New Parent Management Modules
  getStudentParent,
  getAvailableParents,
  linkExistingParent,
  createNewParent,
  unlinkParent,
  getParentAccount,
  addWalletFunds,
  unlinkStudent,
  
  // Helper functions
  generateParentId,
  calculateAge,
  getAccessStatus,
  getStudentParentInfo,
  
  // New function for student filtering
  getAvailableStudents,
  
  // Financial transaction functions
  getFinancialTransactions,
  createFinancialTransaction,
  getFinancialDashboard,
  deleteFinancialTransaction,

  analytics,              // Updated function
  getAnalyticsData,       // Updated function
  getTuitionAnalytics,    // New function
  getGradesData,          // Already exists
  getActivitiesData,


  // NEW SYSTEM RESET FUNCTIONS
  systemResetPage,
  resetAllPayments,
  deleteSelectedUsers,
  resetNewTerm
};