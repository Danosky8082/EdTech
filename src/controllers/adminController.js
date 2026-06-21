const prisma = require('../config/database');
const { hashPassword } = require('../utils/passwordUtils');
const { getActivityIcon, getActivityBadgeColor } = require('../utils/activityHelpers');
const { uploadToBlob } = require('../utils/fileUpload');

// ============================================================
// HELPERS
// ============================================================
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
// DASHBOARD (updated – builds notification HTML in controller)
// ============================================================
const dashboard = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // --- Filters for school-based filtering ---
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

    // --- Fetch statistics ---
    const totalStudents = await prisma.student.count({ where: studentWhere });
    const totalTeachers = await prisma.teacher.count({ where: teacherWhere });
    const totalClasses = await prisma.class.count({ where: classWhere });
    const totalAssignments = await prisma.assignment.count({ where: assignmentWhere });

    // --- Recent activities ---
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

    // --- Notifications (raw data for navbar) ---
    const notifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // --- Build notification dropdown HTML (to avoid loops in EJS) ---
    let notificationsDropdownHtml = '';
    const unreadCount = notifications.filter(n => !n.read).length;

    if (notifications && notifications.length > 0) {
      let itemsHtml = '';
      // Limit to 5 most recent
      const displayNotifications = notifications.slice(0, 5);
      displayNotifications.forEach(n => {
        const isRead = n.read ? 'read' : 'unread';
        const icon = n.icon || 'fa-info-circle';
        const title = n.title || 'Notification';
        const msg = n.message || '';
        const time = n.createdAt ? new Date(n.createdAt).toLocaleString() : '';
        const notifId = n.id || '';
        const newBadge = !n.read ? `<span class="badge bg-danger ms-1">New</span>` : '';
        const actions = !n.read
          ? `<div class="notification-actions">
               <button class="notification-action-btn mark-as-read-btn" onclick="event.stopPropagation(); markNotificationAsRead('${notifId}')">Mark as read</button>
             </div>`
          : '';
        itemsHtml += `
          <li class="notification-item ${isRead}" data-notification-id="${notifId}">
            <div class="notification-icon"><i class="fas ${icon}"></i></div>
            <div class="notification-content">
              <div class="notification-title">${title} ${newBadge}</div>
              <div class="notification-message">${msg}</div>
              <div class="notification-time">${time}</div>
              ${actions}
            </div>
          </li>
        `;
      });
      // Mark all read button
      const markAllReadBtn = `<li class="mark-all-read" onclick="markAllNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Mark all as read</li>`;
      const header = `<li class="notification-header">
                        <span>Notifications</span>
                        ${unreadCount > 0 ? `<span class="badge bg-primary rounded-pill">${unreadCount}</span>` : ''}
                      </li>`;
      notificationsDropdownHtml = header + itemsHtml + markAllReadBtn;
    } else {
      notificationsDropdownHtml = `<li class="notification-empty"><i class="fas fa-bell-slash"></i><p>No notifications</p></li>`;
    }

    // --- User data for navbar ---
    const user = req.session.user;
    let avatarUrl = '';
    let fallbackAvatar = '';
    if (user) {
      const firstName = user.firstName || '';
      const lastName = user.lastName || '';
      fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + ' ' + lastName)}&background=6a11cb&color=fff&size=36`;
      if (user.avatar) {
        if (user.avatar.startsWith('http://') || user.avatar.startsWith('https://')) {
          avatarUrl = user.avatar;
        } else {
          avatarUrl = '/' + user.avatar;
        }
      }
    }

    const currentAdmin = await prisma.admin.findUnique({
      where: { userId: userId }
    });

    // --- Render the dashboard with all variables ---
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      overview: {
        totalStudents,
        totalTeachers,
        totalClasses,
        totalAssignments
      },
      recentActivities: formattedActivities,
      // Pass the pre‑built HTML string and other navbar data
      notificationsDropdownHtml: notificationsDropdownHtml,
      notificationCount: unreadCount,
      userRole: user.role || '',
      userFirstName: user.firstName || '',
      userLastName: user.lastName || '',
      avatarUrl: avatarUrl,
      fallbackAvatar: fallbackAvatar,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin,
      adminInfo: currentAdmin || null,
      user: user
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
// CREATE USER (with avatar fix)
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

    // Avatar upload – use Blob URL or fallback
    let avatarUrl = null;
    if (req.file) {
      try {
        avatarUrl = await uploadToBlob(req.file, 'profiles');
      } catch (blobError) {
        console.error('Blob upload error:', blobError);
        avatarUrl = `uploads/profiles/${req.file.filename}`;
      }
    }

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
        avatar: avatarUrl,   // now correctly defined
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
// UPDATE USER (with avatar fix)
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
    
    // --- Avatar handling ---
    let avatarUrl = user.avatar; // keep existing if no new file
    if (req.file) {
      try {
        avatarUrl = await uploadToBlob(req.file, 'profiles');
      } catch (blobError) {
        console.error('Blob upload error:', blobError);
        // fallback: store as relative path (not recommended for Vercel)
        avatarUrl = `uploads/profiles/${req.file.filename}`;
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        email,
        phone,
        dateOfBirth: parsedDateOfBirth,
        avatar: avatarUrl,   // now always defined
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

// ============================================================
// USER MANAGEMENT
// ============================================================
// ============================================================
// USER MANAGEMENT
// ============================================================
const manageUsers = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    const canSeeAllSchoolUsers = req.canSeeAllSchoolUsers;
    
    let whereClause = {};
    
    if (isSuperAdmin) {
      console.log('🔓 Super Admin - showing all users from all schools');
    } else if (userSchool) {
      whereClause = { school: userSchool };
      console.log(`🔒 School filtering applied: ${userSchool}`);
    } else {
      console.log('❌ No school assigned and not super admin - showing no users');
      whereClause = { school: 'NON_EXISTENT_SCHOOL' };
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      include: {
        student: {
          include: {
            tuitionPayments: {
              orderBy: { createdAt: 'desc' },
              take: 1
            },
            parents: {
              include: {
                parent: {
                  include: { user: true, wallet: true }
                }
              }
            }
          }
        },
        teacher: true,
        admin: true,
        parent: {
          include: {
            wallet: {
              include: {
                transactions: {
                  orderBy: { createdAt: 'desc' },
                  take: 5
                }
              }
            },
            students: {
              include: {
                student: {
                  include: { user: true }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    const usersWithAge = users.map(user => ({
      ...user,
      age: calculateAge(user.dateOfBirth)
    }));

    const now = new Date();
    const paidStudents = users.filter(user => 
      user.role === 'student' && user.student && user.student.tuitionStatus === 'paid'
    ).length;
    const partialStudents = users.filter(user => 
      user.role === 'student' && user.student && user.student.tuitionStatus === 'partial'
    ).length;
    const unpaidStudents = users.filter(user => 
      user.role === 'student' && user.student && user.student.tuitionStatus === 'unpaid'
    ).length;
    const expiredStudents = users.filter(user => {
      if (user.role === 'student' && user.student && user.student.tuitionStatus === 'partial') {
        return user.student.tempPasswordExpiry && new Date(user.student.tempPasswordExpiry) < now;
      }
      return false;
    }).length;

    const parentCount = users.filter(user => user.role === 'parent').length;
    const walletBalance = users.reduce((total, user) => {
      if (user.role === 'parent' && user.parent && user.parent.wallet) {
        return total + user.parent.wallet.balance;
      }
      return total;
    }, 0);
    
    const success = req.query.success;
    const error = req.query.error;

    // --- Get notification count for navbar ---
    const userId = req.session.user.id;
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

    // --- Fetch notifications for navbar dropdown ---
    const notifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // --- Build notification dropdown HTML ---
    let notificationsDropdownHtml = '';
    const unreadCount = notifications.filter(n => !n.read).length;

    if (notifications && notifications.length > 0) {
      let itemsHtml = '';
      const displayNotifications = notifications.slice(0, 5);
      displayNotifications.forEach(n => {
        const isRead = n.read ? 'read' : 'unread';
        const icon = n.icon || 'fa-info-circle';
        const title = n.title || 'Notification';
        const msg = n.message || '';
        const time = n.createdAt ? new Date(n.createdAt).toLocaleString() : '';
        const notifId = n.id || '';
        const newBadge = !n.read ? `<span class="badge bg-danger ms-1">New</span>` : '';
        const actions = !n.read
          ? `<div class="notification-actions">
               <button class="notification-action-btn mark-as-read-btn" onclick="event.stopPropagation(); markNotificationAsRead('${notifId}')">Mark as read</button>
             </div>`
          : '';
        itemsHtml += `
          <li class="notification-item ${isRead}" data-notification-id="${notifId}">
            <div class="notification-icon"><i class="fas ${icon}"></i></div>
            <div class="notification-content">
              <div class="notification-title">${title} ${newBadge}</div>
              <div class="notification-message">${msg}</div>
              <div class="notification-time">${time}</div>
              ${actions}
            </div>
          </li>
        `;
      });
      const markAllReadBtn = `<li class="mark-all-read" onclick="markAllNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Mark all as read</li>`;
      const header = `<li class="notification-header">
                        <span>Notifications</span>
                        ${unreadCount > 0 ? `<span class="badge bg-primary rounded-pill">${unreadCount}</span>` : ''}
                      </li>`;
      notificationsDropdownHtml = header + itemsHtml + markAllReadBtn;
    } else {
      notificationsDropdownHtml = `<li class="notification-empty"><i class="fas fa-bell-slash"></i><p>No notifications</p></li>`;
    }

    // --- Compute avatar data for navbar ---
    const user = req.session.user;
    let avatarUrl = '';
    let fallbackAvatar = '';
    if (user) {
      const firstName = user.firstName || '';
      const lastName = user.lastName || '';
      fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + ' ' + lastName)}&background=6a11cb&color=fff&size=36`;
      if (user.avatar) {
        if (user.avatar.startsWith('http://') || user.avatar.startsWith('https://')) {
          avatarUrl = user.avatar;
        } else {
          avatarUrl = '/' + user.avatar;
        }
      }
    }
    
    res.render('admin/users', { 
      title: 'User Management',
      users: usersWithAge,
      paidStudents,
      partialStudents,
      unpaidStudents,
      expiredStudents,
      parentCount,
      walletBalance,
      userSchool,
      isSuperAdmin,
      canSeeAllSchoolUsers,
      userRole: req.user.role,
      adminInfo: req.user?.admin || null,
      success,
      error,
      getAccessStatus,
      // Navbar variables
      notificationCount: notificationCount,
      notificationsDropdownHtml: notificationsDropdownHtml,
      userFirstName: user ? user.firstName || '' : '',
      userLastName: user ? user.lastName || '' : '',
      avatarUrl: avatarUrl,
      fallbackAvatar: fallbackAvatar,
      // You may also pass the full notifications array if needed elsewhere
      notifications: notifications
    });
  } catch (error) {
    console.error('Manage users error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null
    });
  }
};

// ============================================================
// TUITION MANAGEMENT
// ============================================================
const manageTuition = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
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
            id: true,
            idNumber: true,
            firstName: true,
            lastName: true,
            email: true,
            school: true,
            isActive: true
          }
        },
        tuitionPayments: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: {
        user: {
          firstName: 'asc'
        }
      }
    });

    const simpleStudents = students.map(student => ({
      id: student.id,
      firstName: student.user.firstName,
      lastName: student.user.lastName,
      idNumber: student.user.idNumber,
      email: student.user.email,
      school: student.user.school,
      isActive: student.user.isActive,
      grade: student.grade,
      section: student.section,
      tuitionStatus: student.tuitionStatus,
      canChangePassword: student.canChangePassword,
      tempPasswordExpiry: student.tempPasswordExpiry,
      lastPayment: student.tuitionPayments.length > 0 ? student.tuitionPayments[0] : null,
      accessStatus: student.tuitionStatus === 'paid' ? 'active' : 
                   (student.tuitionStatus === 'partial' && 
                    student.tempPasswordExpiry && 
                    new Date(student.tempPasswordExpiry) > new Date()) ? 'active' : 'no-access'
    }));

    res.render('admin/tuition-management', {
      title: 'Tuition Management',
      students: simpleStudents,
      currentUserSchool: userSchool,
      isSuperAdmin: isSuperAdmin,
      adminInfo: req.user?.admin || null,
      user: req.user
    });
  } catch (error) {
    console.error('Manage tuition error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null
    });
  }
};

const recordPayment = async (req, res) => {
  try {
    const { studentId, receiptNumber, amount, semester, paymentDate } = req.body;
    const adminId = req.session.user.id;

    if (!studentId || !receiptNumber) {
      return res.status(400).json({ success: false, message: 'Student ID and receipt number are required' });
    }

    const existingPayment = await prisma.tuitionPayment.findUnique({
      where: { receiptNumber }
    });

    if (existingPayment) {
      return res.status(400).json({ success: false, message: 'Receipt number already exists' });
    }

    const payment = await prisma.tuitionPayment.create({
      data: {
        receiptNumber,
        amount: parseFloat(amount) || 0,
        status: 'verified',
        verifiedBy: adminId,
        verifiedAt: new Date(),
        studentId: studentId,
        semester: semester || `${new Date().getFullYear()}-1`,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date()
      }
    });

    await prisma.student.update({
      where: { id: studentId },
      data: {
        tuitionStatus: 'paid',
        canChangePassword: true,
        tempPasswordExpiry: null
      }
    });

    const student = await prisma.student.findUnique({
      where: { id: studentId },
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
      message: 'Payment recorded successfully',
      payment
    });
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({ success: false, message: 'Failed to record payment' });
  }
};

const resetStudentPassword = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { passwordType } = req.body;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { user: true }
    });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    let newPassword;
    let isTemporary = false;
    let tempPasswordExpiry = null;

    if (passwordType === 'temporary') {
      newPassword = generateTemporaryPassword();
      isTemporary = true;
      tempPasswordExpiry = calculatePasswordExpiry(30);

      await prisma.student.update({
        where: { id: studentId },
        data: {
          canChangePassword: false,
          tempPasswordExpiry: tempPasswordExpiry
        }
      });
    } else {
      if (student.tuitionStatus !== 'paid') {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot set permanent password for unpaid students' 
        });
      }
      newPassword = generateTemporaryPassword();
      isTemporary = false;
    }

    const hashedPassword = await hashPassword(newPassword);

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
      newPassword: newPassword,
      isTemporary: isTemporary,
      expiryDate: tempPasswordExpiry
    });
  } catch (error) {
    console.error('Reset student password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
};

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

// ============================================================
// TOGGLE USER STATUS
// ============================================================
const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const updatedUser = await prisma.user.update({
      where: { id: userId },
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

// ============================================================
// GET USER (for editing)
// ============================================================
const getUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        student: true,
        teacher: true,
        admin: true,
        cashier: true,
        accountant: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
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

// ============================================================
// GET AVAILABLE STUDENTS (for parent linking)
// ============================================================
const getAvailableStudents = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const { grade, section } = req.query;
    
    let whereClause = {
      user: {
        role: 'student'
      },
      parents: {
        none: {}
      }
    };
    
    if (userSchool) {
      whereClause.user.school = userSchool;
    }
    if (grade) {
      whereClause.grade = grade;
    }
    if (section) {
      whereClause.section = section;
    }
    
    const students = await prisma.student.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            idNumber: true,
            firstName: true,
            lastName: true,
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
    
    res.json({
      success: true,
      students: students,
      total: students.length
    });
  } catch (error) {
    console.error('Get available students error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// CLASS MANAGEMENT
// ============================================================
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

const createClass = async (req, res) => {
  try {
    const { name, grade, section, teacherId } = req.body;
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
      adminInfo: req.user?.admin || null
    });
  }
};

const getClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
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
    if (!isSuperAdmin && cls.teacher.user.school !== userSchool) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have permission to edit this class' 
      });
    }
    
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

const updateClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const { name, grade, section, teacherId } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    if (!name || !grade || !section || !teacherId) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    const existingClass = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: {
            user: {
              select: { school: true }
            }
          }
        }
      }
    });
    if (!existingClass) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    if (!isSuperAdmin && existingClass.teacher.user.school !== userSchool) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have permission to update this class' 
      });
    }
    if (!isSuperAdmin) {
      const newTeacher = await prisma.teacher.findUnique({
        where: { id: teacherId },
        include: {
          user: {
            select: { school: true }
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
    const updatedClass = await prisma.class.update({
      where: { id: classId },
      data: {
        name,
        grade,
        section,
        teacherId: teacherId
      }
    });
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

const deleteClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const existingClass = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: {
            user: {
              select: { school: true }
            }
          }
        }
      }
    });
    if (!existingClass) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    if (!isSuperAdmin && existingClass.teacher.user.school !== userSchool) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have permission to delete this class' 
      });
    }
    await prisma.class.delete({
      where: { id: classId }
    });
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

const viewClassStudents = async (req, res) => {
  try {
    const { classId } = req.params;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
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
    if (!isSuperAdmin && classData.teacher.user.school !== userSchool) {
      req.flash('error', 'You do not have permission to view this class');
      return res.redirect('/admin/classes');
    }
    let filteredEnrollments = classData.enrollments;
    if (!isSuperAdmin) {
      filteredEnrollments = classData.enrollments.filter(enrollment => 
        enrollment.student.user.school === userSchool
      );
    }
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

const getEnrollStudents = async (req, res) => {
  try {
    const { classId } = req.params;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
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
    if (!isSuperAdmin && classData.teacher.user.school !== userSchool) {
      req.flash('error', 'You do not have permission to manage students in this class');
      return res.redirect('/admin/classes');
    }
    const whereCondition = isSuperAdmin 
      ? {} 
      : { user: { school: userSchool } };
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
    const enrolledStudents = classData.enrollments;
    const success = req.query.success;
    const error = req.query.error;
    res.render('admin/enroll-students', {
      title: `Enroll Students - ${classData.name}`,
      classData,
      enrolledStudents,
      availableStudents,
      currentSchool: userSchool,
      isSuperAdmin,
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

const enrollStudents = async (req, res) => {
  try {
    const { classId } = req.params;
    const { studentIds } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    if (!studentIds) {
      req.flash('error', 'Please select at least one student to enroll');
      return res.redirect(`/admin/classes/${classId}/enroll`);
    }
    const studentIdsArray = Array.isArray(studentIds) ? studentIds : [studentIds];
    if (studentIdsArray.length === 0) {
      req.flash('error', 'Please select at least one student to enroll');
      return res.redirect(`/admin/classes/${classId}/enroll`);
    }
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: {
            user: {
              select: { school: true }
            }
          }
        }
      }
    });
    if (!classData) {
      req.flash('error', 'Class not found');
      return res.redirect('/admin/classes');
    }
    if (!isSuperAdmin && classData.teacher.user.school !== userSchool) {
      req.flash('error', 'You do not have permission to enroll students in this class');
      return res.redirect('/admin/classes');
    }
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
      const invalidStudents = students.filter(student => 
        student.user.school !== userSchool
      );
      if (invalidStudents.length > 0) {
        const invalidNames = invalidStudents.map(s => 
          `${s.user.firstName} ${s.user.lastName} (${s.user.school})`
        ).join(', ');
        req.flash('error', `Cannot enroll students from other schools: ${invalidNames}`);
        return res.redirect(`/admin/classes/${classId}/enroll`);
      }
    }
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
      req.flash('error', `Some students are already enrolled: ${duplicateNames}`);
      return res.redirect(`/admin/classes/${classId}/enroll`);
    }
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
    const successfulEnrollments = enrollments.filter(enrollment => enrollment !== null);
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
      }
    }
    req.flash('success', `${successfulEnrollments.length} student(s) enrolled successfully in ${classData.name}`);
    return res.redirect(`/admin/classes/${classId}/enroll`);
  } catch (error) {
    console.error('Error enrolling students:', error);
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

const removeStudent = async (req, res) => {
  try {
    const classId = req.params.classId;
    const studentId = req.params.studentId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: {
            user: {
              select: { school: true }
            }
          }
        }
      }
    });
    if (!classData) {
      req.flash('error', 'Class not found');
      return res.redirect('/admin/classes');
    }
    if (!isSuperAdmin && classData.teacher.user.school !== userSchool) {
      req.flash('error', 'You do not have permission to remove students from this class');
      return res.redirect('/admin/classes');
    }
    const result = await prisma.enrollment.deleteMany({
      where: {
        AND: [
          { classId: classId },
          { studentId: studentId }
        ]
      }
    });
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

// ============================================================
// ANALYTICS & ACTIVITIES
// ============================================================
const analytics = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
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

    const teacherSubjects = await prisma.teacher.findMany({
      where: teacherWhere,
      select: { subject: true }
    });
    const totalSubjects = [...new Set(teacherSubjects.map(t => t.subject))].length;

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

    const gradeRanges = { '90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, '0-59': 0 };
    
    grades.forEach(grade => {
      if (grade >= 90) gradeRanges['90-100']++;
      else if (grade >= 80) gradeRanges['80-89']++;
      else if (grade >= 70) gradeRanges['70-79']++;
      else if (grade >= 60) gradeRanges['60-69']++;
      else gradeRanges['0-59']++;
    });

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

    const studentsForTuition = await prisma.student.findMany({
      where: studentWhere,
      select: {
        tuitionStatus: true
      }
    });

    const paidStudents = studentsForTuition.filter(s => s.tuitionStatus === 'paid').length;
    const partialStudents = studentsForTuition.filter(s => s.tuitionStatus === 'partial').length;
    const unpaidStudents = studentsForTuition.filter(s => s.tuitionStatus === 'unpaid').length;

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
    console.error('Analytics error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      currentUserSchool: req.userSchool,
      isSuperAdmin: req.isSuperAdmin,
      adminInfo: req.user?.admin || null
    });
  }
};

const activitiesLog = async (req, res) => {
  try {
    const totalActivities = await prisma.user.count() + await prisma.assignment.count();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayActivities = await prisma.user.count({
      where: { createdAt: { gte: today } }
    });
    const uniqueUsers = await prisma.user.count();
    const systemActivities = await prisma.assignment.count();

    const recentUsers = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        student: true,
        teacher: true,
        admin: true
      }
    });

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
      ipAddress: '192.168.1.' + Math.floor(Math.random() * 255)
    }));

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
      adminInfo: req.user?.admin || null
    });
  } catch (error) {
    console.error('Activities log error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null
    });
  }
};

// ============================================================
// STUDENT TUITION FUNCTIONS
// ============================================================
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
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      }
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    res.json({ success: true, student });
  } catch (error) {
    console.error('Get student tuition error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const updateStudentTuition = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { tuitionStatus, accessDays, receiptNumber } = req.body;
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    const canChangePassword = tuitionStatus === 'paid';
    const tempPasswordExpiry = tuitionStatus === 'partial' ? calculatePasswordExpiry(parseInt(accessDays) || 30) : null;
    await prisma.student.update({
      where: { id: studentId },
      data: {
        tuitionStatus,
        canChangePassword,
        tempPasswordExpiry
      }
    });
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
    if (tuitionStatus === 'paid') {
      await prisma.user.update({
        where: { id: student.userId },
        data: { isTemporaryPassword: false }
      });
    }
    res.json({ success: true, message: 'Tuition status updated successfully' });
  } catch (error) {
    console.error('Update student tuition error:', error);
    if (error.code === 'P2003') {
      return res.status(400).json({ success: false, message: 'Database error: Invalid student reference' });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const extendAccess = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { days } = req.body;
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    if (student.tuitionStatus !== 'partial') {
      return res.status(400).json({ success: false, message: 'Can only extend access for partial payment students' });
    }
    const newExpiry = calculatePasswordExpiry(parseInt(days) || 30);
    await prisma.student.update({
      where: { id: studentId },
      data: { tempPasswordExpiry: newExpiry }
    });
    res.json({ success: true, message: `Access extended by ${days} days successfully`, newExpiry });
  } catch (error) {
    console.error('Extend access error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// SCHOOL MANAGEMENT (super admin only)
// ============================================================
const manageSchools = async (req, res) => {
  try {
    if (!req.isSuperAdmin) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }
    const schools = await prisma.user.groupBy({
      by: ['school'],
      where: {
        school: { not: null }
      },
      _count: { id: true }
    });
    res.render('admin/schools', {
      title: 'School Management',
      schools: schools.filter(s => s.school),
      adminInfo: req.user?.admin || null
    });
  } catch (error) {
    console.error('Manage schools error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      adminInfo: req.user?.admin || null
    });
  }
};

const checkIdNumber = async (req, res) => {
  try {
    const { idNumber } = req.params;
    const existingUser = await prisma.user.findUnique({ where: { idNumber } });
    res.json({ available: !existingUser });
  } catch (error) {
    console.error('Check ID number error:', error);
    res.status(500).json({ available: false });
  }
};

// ============================================================
// PARENT MANAGEMENT
// ============================================================
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
                      orderBy: { createdAt: 'desc' },
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
    res.json({ success: true, student });
  } catch (error) {
    console.error('Get student parent error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
};

const getAvailableParents = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    let whereClause = { role: 'parent' };
    if (!isSuperAdmin && userSchool) {
      whereClause.school = userSchool;
    }
    const parents = await prisma.user.findMany({
      where: whereClause,
      include: {
        parent: {
          include: {
            students: { include: { student: true } },
            wallet: true
          }
        }
      }
    });
    const validParents = parents.filter(parent => parent && parent.id && parent.firstName && parent.lastName);
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

const linkExistingParent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { parentId, relationship } = req.body;
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    const parent = await prisma.parent.findUnique({ where: { userId: parentId } });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent not found' });
    }
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
    await prisma.studentParent.create({
      data: {
        parentId: parent.id,
        studentId: student.id,
        relationship: relationship || 'parent'
      }
    });
    res.json({ success: true, message: 'Parent linked to student successfully' });
  } catch (error) {
    console.error('Link existing parent error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

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
    const parentIdNumber = await generateParentId();
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
    const parent = await prisma.parent.create({ data: { userId: parentUser.id } });
    await prisma.wallet.create({ data: { parentId: parent.id, balance: 0 } });
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

const unlinkParent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { parentId } = req.body;
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    const parent = await prisma.parent.findUnique({ where: { userId: parentId } });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent not found' });
    }
    await prisma.studentParent.delete({
      where: {
        parentId_studentId: {
          parentId: parent.id,
          studentId: student.id
        }
      }
    });
    res.json({ success: true, message: 'Parent unlinked from student successfully' });
  } catch (error) {
    console.error('Unlink parent error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

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
              orderBy: { createdAt: 'desc' },
              take: 10
            }
          }
        },
        students: {
          include: {
            student: {
              include: { user: true }
            }
          }
        }
      }
    });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent not found' });
    }
    res.json({ success: true, parent });
  } catch (error) {
    console.error('Get parent account error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

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
    let wallet = parent.wallet;
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          parentId: parent.id,
          balance: parseFloat(amount)
        }
      });
    } else {
      wallet = await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: wallet.balance + parseFloat(amount)
        }
      });
    }
    await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        amount: parseFloat(amount),
        type: 'deposit',
        description: description || 'Admin deposit',
        status: 'completed'
      }
    });
    res.json({
      success: true,
      message: `₦${amount} added to parent wallet successfully`
    });
  } catch (error) {
    console.error('Add wallet funds error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const unlinkStudent = async (req, res) => {
  try {
    const { parentId } = req.params;
    const { studentId } = req.body;
    const parent = await prisma.parent.findUnique({ where: { userId: parentId } });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent not found' });
    }
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    await prisma.studentParent.delete({
      where: {
        parentId_studentId: {
          parentId: parent.id,
          studentId: student.id
        }
      }
    });
    res.json({ success: true, message: 'Student unlinked from parent successfully' });
  } catch (error) {
    console.error('Unlink student error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getStudentParentInfo = async (req, res) => {
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
                      orderBy: { createdAt: 'desc' },
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
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    res.json({ success: true, student });
  } catch (error) {
    console.error('Get student parent info error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// CLASS STUDENTS & SAVINGS GOALS
// ============================================================
const getClassStudents = async (req, res) => {
  try {
    const { classId } = req.params;
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: { include: { user: true } },
        enrollments: {
          include: {
            student: {
              include: { 
                user: true,
                parents: {
                  include: {
                    parent: { include: { user: true } }
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!classData) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    const students = classData.enrollments.map(enrollment => enrollment.student);
    res.json({
      success: true,
      class: {
        id: classData.id,
        name: classData.name,
        grade: classData.grade,
        section: classData.section,
        teacher: classData.teacher?.user
      },
      students
    });
  } catch (error) {
    console.error('Get class students error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getSavingsGoal = async (req, res) => {
  try {
    const { id } = req.params;
    const goal = await prisma.savingsGoal.findUnique({
      where: { id },
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
      return res.status(404).json({ success: false, message: 'Savings goal not found' });
    }
    const progress = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
    const response = {
      ...goal,
      progress: progress.toFixed(1),
      remainingAmount: goal.targetAmount - goal.currentAmount,
      isCompleted: goal.currentAmount >= goal.targetAmount,
      canTransfer: goal.currentAmount > 0 && goal.isActive
    };
    res.json({ success: true, goal: response });
  } catch (error) {
    console.error('Error fetching savings goal:', error);
    if (error.code === 'P2023') {
      return res.status(400).json({ success: false, message: 'Invalid savings goal ID format' });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Savings goal not found' });
    }
    res.status(500).json({ success: false, message: 'Server error while fetching savings goal' });
  }
};

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
      const progress = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
      return {
        ...goal,
        progress: progress.toFixed(1),
        remainingAmount: goal.targetAmount - goal.currentAmount,
        isCompleted: goal.currentAmount >= goal.targetAmount
      };
    });
    res.json({ success: true, goals: goalsWithProgress, total: goals.length });
  } catch (error) {
    console.error('Error fetching all savings goals:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// FINANCIAL TRANSACTIONS (placeholders)
// ============================================================
const getFinancialTransactions = async (req, res) => {
  res.json({ success: true, transactions: [] });
};
const createFinancialTransaction = async (req, res) => {
  res.json({ success: true, message: 'Transaction created successfully' });
};
const getFinancialDashboard = async (req, res) => {
  res.json({ success: true, dashboard: {} });
};
const deleteFinancialTransaction = async (req, res) => {
  res.json({ success: true, message: 'Transaction deleted successfully' });
};

// ============================================================
// TUITION & ANALYTICS (additional)
// ============================================================
const getTuitionAnalytics = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
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
          select: { isActive: true }
        }
      }
    });
    const paidStudents = students.filter(s => s.tuitionStatus === 'paid').length;
    const partialStudents = students.filter(s => s.tuitionStatus === 'partial').length;
    const unpaidStudents = students.filter(s => s.tuitionStatus === 'unpaid').length;
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
      collectionRate: students.length > 0 ? Math.round((paidStudents / students.length) * 100) : 0
    });
  } catch (error) {
    console.error('Tuition analytics error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

const getAnalyticsData = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    let studentWhere = {}, teacherWhere = {}, adminWhere = {}, classWhere = {}, assignmentWhere = {},
        materialWhere = {}, submissionWhere = {}, parentWhere = {}, userWhere = {};
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
      prisma.parent.count({ where: { ...parentWhere, wallet: { isNot: null } } })
    ]);
    const teacherSubjects = await prisma.teacher.findMany({
      where: teacherWhere,
      select: { subject: true }
    });
    const totalSubjects = [...new Set(teacherSubjects.map(t => t.subject))].length;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const [recentMaterials, recentAssignments, recentSubmissions] = await Promise.all([
      prisma.material.count({ where: { createdAt: { gte: thirtyDaysAgo }, ...materialWhere } }),
      prisma.assignment.count({ where: { createdAt: { gte: thirtyDaysAgo }, ...assignmentWhere } }),
      prisma.submission.count({ where: { submittedAt: { gte: thirtyDaysAgo }, ...submissionWhere } })
    ]);
    const [activeStudents, activeTeachers] = await Promise.all([
      prisma.user.count({ where: { role: 'student', ...userWhere, isActive: true } }),
      prisma.user.count({ where: { role: 'teacher', ...userWhere, isActive: true } })
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
      isSuperAdmin
    });
  } catch (error) {
    console.error('Analytics data error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics data', error: error.message });
  }
};

const getGradesData = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    let whereClause = {};
    if (userSchool && !isSuperAdmin) {
      whereClause = { student: { user: { school: userSchool } } };
    }
    const submissions = await prisma.submission.findMany({
      where: { grade: { not: null }, ...whereClause },
      select: { grade: true }
    });
    const grades = submissions.map(s => s.grade);
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
      averageGrade: grades.length > 0 ? (grades.reduce((sum, grade) => sum + grade, 0) / grades.length).toFixed(1) : 0
    });
  } catch (error) {
    console.error('Grades data error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch grades data' });
  }
};

const getActivitiesData = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    let whereClause = {};
    if (userSchool && !isSuperAdmin) {
      whereClause = { school: userSchool };
    }
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
    res.json({ success: true, activities: formattedActivities, total: formattedActivities.length });
  } catch (error) {
    console.error('Activities data error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch activities data' });
  }
};

// ============================================================
// SYSTEM RESET FUNCTIONS
// ============================================================
const systemResetPage = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    let whereClause = {};
    if (userSchool && !isSuperAdmin) {
      whereClause = { school: userSchool };
    }
    const studentCount = await prisma.user.count({ where: { ...whereClause, role: 'student' } });
    const parentCount = await prisma.user.count({ where: { ...whereClause, role: 'parent' } });
    const teacherCount = await prisma.user.count({ where: { ...whereClause, role: 'teacher' } });
    const students = await prisma.student.findMany({
      where: userSchool && !isSuperAdmin ? { user: { school: userSchool } } : {},
      select: { tuitionStatus: true }
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

const resetAllPayments = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    const { confirmation, resetType } = req.body;
    if (confirmation !== 'CONFIRM') {
      return res.status(400).json({ success: false, message: 'Please type CONFIRM to proceed' });
    }
    let whereClause = {};
    if (userSchool && !isSuperAdmin) {
      whereClause = { user: { school: userSchool } };
    }
    const students = await prisma.student.findMany({ where: whereClause, include: { user: true } });
    let updatedCount = 0;
    for (const student of students) {
      await prisma.student.update({
        where: { id: student.id },
        data: {
          tuitionStatus: resetType === 'partial' ? 'partial' : 'unpaid',
          canChangePassword: false,
          tempPasswordExpiry: resetType === 'partial' ? calculatePasswordExpiry(30) : null
        }
      });
      await prisma.user.update({
        where: { id: student.userId },
        data: { isTemporaryPassword: true }
      });
      updatedCount++;
    }
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
    res.status(500).json({ success: false, message: 'Failed to reset payments: ' + error.message });
  }
};

const deleteSelectedUsers = async (req, res) => {
  try {
    const { userIds, userType, confirmation } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    if (confirmation !== 'DELETE') {
      return res.status(400).json({ success: false, message: 'Please type DELETE to confirm deletion' });
    }
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No users selected for deletion' });
    }
    let baseWhere = { id: { in: userIds } };
    if (userSchool && !isSuperAdmin) {
      baseWhere.school = userSchool;
    }
    if (userType && userType !== 'all') {
      baseWhere.role = userType;
    }
    const usersToDelete = await prisma.user.findMany({
      where: baseWhere,
      select: { id: true, idNumber: true, firstName: true, lastName: true, role: true, school: true }
    });
    if (usersToDelete.length === 0) {
      return res.status(404).json({ success: false, message: 'No matching users found to delete' });
    }
    let deletedCount = 0, errors = [];
    for (const user of usersToDelete) {
      try {
        await prisma.user.delete({ where: { id: user.id } });
        deletedCount++;
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
    res.status(500).json({ success: false, message: 'Failed to delete users: ' + error.message });
  }
};

const resetNewTerm = async (req, res) => {
  try {
    const { term, section, year, confirmation } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    if (confirmation !== 'RESET') {
      return res.status(400).json({ success: false, message: 'Please type RESET to confirm new term reset' });
    }
    let whereClause = {};
    if (userSchool && !isSuperAdmin) {
      whereClause = { school: userSchool };
    }
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
            data: { isTemporaryPassword: true }
          })
        );
        updatedCount++;
      } else if (user.role === 'teacher' && user.teacher) {
        operations.push(
          prisma.teacher.update({
            where: { id: user.teacher.id },
            data: { updatedAt: new Date() }
          })
        );
        updatedCount++;
      }
    }
    await Promise.all(operations);
    try {
      await prisma.activityLog.create({
        data: {
          userId: req.session.user.id,
          action: 'new_term_reset',
          description: `Reset ${updatedCount} users for ${term || 'new term'} ${section || ''} ${year || new Date().getFullYear()}`,
          ipAddress: req.ip
        }
      });
    } catch (logError) {
      console.log('Could not log term reset');
    }
    res.json({
      success: true,
      message: `Successfully reset ${updatedCount} users for new term/section`,
      count: updatedCount,
      termDetails: { term, section, year: year || new Date().getFullYear() }
    });
  } catch (error) {
    console.error('Reset new term error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset for new term: ' + error.message });
  }
};

// ============================================================
// MODULE EXPORTS
// ============================================================
module.exports = {
  dashboard,
  createUser,
  updateUser,
  manageUsers,
  manageTuition,
  recordPayment,
  resetStudentPassword,
  checkPasswordExpiry,
  toggleUserStatus,
  getUser,
  getAvailableStudents,
  manageClasses,
  createClass,
  getClass,
  updateClass,
  deleteClass,
  viewClassStudents,
  getEnrollStudents,
  enrollStudents,
  removeStudent,
  analytics,
  activitiesLog,
  getStudentTuition,
  updateStudentTuition,
  extendAccess,
  manageSchools,
  checkIdNumber,
  getStudentParent,
  getAvailableParents,
  linkExistingParent,
  createNewParent,
  unlinkParent,
  getParentAccount,
  addWalletFunds,
  unlinkStudent,
  getStudentParentInfo,
  getClassStudents,
  getSavingsGoal,
  getAllSavingsGoals,
  getFinancialTransactions,
  createFinancialTransaction,
  getFinancialDashboard,
  deleteFinancialTransaction,
  getTuitionAnalytics,
  getAnalyticsData,
  getGradesData,
  getActivitiesData,
  systemResetPage,
  resetAllPayments,
  deleteSelectedUsers,
  resetNewTerm
};