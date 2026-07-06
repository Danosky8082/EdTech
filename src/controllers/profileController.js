const prisma = require('../config/database');
const { hashPassword, comparePassword } = require('../utils/passwordUtils');
const { uploadToBlob } = require('../utils/fileUpload');
const { generateQR, generateToken } = require('../utils/qrGenerator');

// ============================================================
// GET PROFILE - for all roles (WITH QR CODE)
// ============================================================
const getProfile = async (req, res) => {
  try {
    const userId = req.session.user.id;

    // Fetch user with all role relations
    const user = await prisma.user.findUnique({
      where: { id: userId },
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
                  include: { user: true }
                }
              }
            }
          }
        },
        teacher: true,
        admin: true,
        parent: {
          include: {
            wallet: true,
            students: {
              include: {
                student: {
                  include: { user: true }
                }
              }
            }
          }
        },
        cashier: true,
        accountant: true
      }
    });

    if (!user) {
      req.flash('error_msg', 'User not found');
      return res.redirect('/');
    }

    // Prepare role-specific data
    let roleData = {};
    if (user.role === 'student' && user.student) {
      roleData = {
        grade: user.student.grade,
        section: user.student.section,
        tuitionStatus: user.student.tuitionStatus,
        canChangePassword: user.student.canChangePassword,
        tempPasswordExpiry: user.student.tempPasswordExpiry,
        lastPayment: user.student.tuitionPayments?.length > 0 ? user.student.tuitionPayments[0] : null,
        parents: user.student.parents.map(sp => sp.parent.user)
      };
    } else if (user.role === 'teacher' && user.teacher) {
      roleData = {
        subject: user.teacher.subject
      };
    } else if (user.role === 'admin' && user.admin) {
      roleData = {
        roleLevel: user.admin.roleLevel
      };
    } else if (user.role === 'parent' && user.parent) {
      roleData = {
        walletBalance: user.parent.wallet?.balance || 0,
        children: user.parent.students.map(sp => sp.student.user)
      };
    } else if (user.role === 'cashier' && user.cashier) {
      roleData = {
        employeeId: user.cashier.employeeId
      };
    } else if (user.role === 'accountant' && user.accountant) {
      roleData = {
        employeeId: user.accountant.employeeId
      };
    }

    // ---------- QR CODE GENERATION ----------
    let qrImage = null;
let qrToken = user.qrToken;
if (!qrToken) {
  qrToken = require('crypto').randomUUID();
  await prisma.user.update({
    where: { id: userId },
    data: { qrToken }
  });
  // Update local user object
  user.qrToken = qrToken;
}
const { generateQR } = require('../utils/qrGenerator');
qrImage = await generateQR(user.qrToken);

    // Avatar handling
    let avatarUrl = '';
    let fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.firstName + ' ' + user.lastName)}&background=6a11cb&color=fff&size=100`;
    if (user.avatar) {
      if (user.avatar.startsWith('http://') || user.avatar.startsWith('https://')) {
        avatarUrl = user.avatar;
      } else {
        avatarUrl = '/' + user.avatar;
      }
    }

    // Notifications for navbar
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

    res.render('profile', {
  title: 'My Profile',
  user: user,
  roleData: roleData,
  avatarUrl: avatarUrl,
  fallbackAvatar: fallbackAvatar,
  notificationsDropdownHtml: notificationsDropdownHtml,
  notificationCount: unreadCount,
  userFirstName: user.firstName,
  userLastName: user.lastName,
  userRole: user.role,
  userSchool: user.school,
  adminInfo: user.admin || null,
  success: req.query.success,
  error: req.query.error,
  qrImage: qrImage,         
});
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// ============================================================
// UPDATE PROFILE (unchanged)
// ============================================================
const updateProfile = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { firstName, lastName, email, phone } = req.body;

    if (!firstName || !lastName) {
      req.flash('error_msg', 'First name and last name are required');
      return res.redirect('/profile');
    }

    const updateData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email ? email.trim() : null,
      phone: phone ? phone.trim() : null
    };

    if (req.file) {
      try {
        const avatarUrl = await uploadToBlob(req.file, 'profiles');
        updateData.avatar = avatarUrl;
      } catch (blobError) {
        console.error('Avatar upload error:', blobError);
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData
    });

    // Update session data
    req.session.user.firstName = updateData.firstName;
    req.session.user.lastName = updateData.lastName;
    req.session.user.email = updateData.email;
    req.session.user.phone = updateData.phone;
    if (updateData.avatar) {
      req.session.user.avatar = updateData.avatar;
    }

    req.flash('success_msg', 'Profile updated successfully');
    res.redirect('/profile?success=Profile updated');
  } catch (error) {
    console.error('Update profile error:', error);
    req.flash('error_msg', 'Failed to update profile');
    res.redirect('/profile?error=Failed to update');
  }
};

// ============================================================
// CHANGE PASSWORD (unchanged)
// ============================================================
const changePassword = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      req.flash('error_msg', 'All password fields are required');
      return res.redirect('/profile');
    }

    if (newPassword.length < 6) {
      req.flash('error_msg', 'New password must be at least 6 characters');
      return res.redirect('/profile');
    }

    if (newPassword !== confirmPassword) {
      req.flash('error_msg', 'Passwords do not match');
      return res.redirect('/profile');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true }
    });

    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      req.flash('error_msg', 'Current password is incorrect');
      return res.redirect('/profile');
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

    req.flash('success_msg', 'Password changed successfully');
    res.redirect('/profile?success=Password changed');
  } catch (error) {
    console.error('Change password error:', error);
    req.flash('error_msg', 'Failed to change password');
    res.redirect('/profile?error=Failed to change password');
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword
};