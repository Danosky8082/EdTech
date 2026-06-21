const prisma = require('../config/database');

// Helper function to format time ago
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

// Create notification function
const createNotification = async (userId, title, message, icon = 'fa-info-circle') => {
  try {
    await prisma.notification.create({
      data: {
        title,
        message,
        icon,
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
};

// Student dashboard
const dashboard = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('🎓 Student Dashboard - User ID:', userId);
    
    // Get student with classes and enrollments
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: true,
        enrollments: {
          include: {
            class: {
              include: {
                teacher: {
                  include: { user: true }
                }
              }
            }
          }
        }
      }
    });

    if (!student) {
      return res.status(404).render('error/404', { title: 'Student Not Found' });
    }

    // Get class IDs for queries
    const classIds = student.enrollments.map(e => e.classId);
    
    // Get upcoming assignments
    let upcomingAssignments = [];
    if (classIds.length > 0) {
      upcomingAssignments = await prisma.assignment.findMany({
        where: {
          classId: { in: classIds },
          dueDate: { gt: new Date() }
        },
        include: {
          class: true,
          teacher: { include: { user: true } }
        },
        orderBy: { dueDate: 'asc' },
        take: 5
      });
    }

    // Completed assignments count
    let completedAssignments = 0;
    if (classIds.length > 0) {
      const submissions = await prisma.submission.count({
        where: { studentId: studentId }
      });
      completedAssignments = submissions;
    }

    // Pending class works & recent class works
    let pendingClassWorks = 0;
    let recentClassWorks = [];
    if (classIds.length > 0) {
      pendingClassWorks = await prisma.classWork.count({
        where: {
          classId: { in: classIds },
          isActive: true,
          submissions: { none: { studentId: studentId } }
        }
      });

      recentClassWorks = await prisma.classWork.findMany({
        where: {
          classId: { in: classIds },
          isActive: true
        },
        include: {
          class: { select: { name: true } },
          teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
          submissions: {
            where: { studentId: studentId },
            select: { id: true, status: true, score: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      });
    }

    // --- Get notifications using the service (or fallback) ---
    let notifications = [];
    let notificationCount = 0;
    try {
      const { notificationService } = require('../services/notificationService');
      const result = await notificationService.getUserNotifications(userId, {
        limit: 10,
        unreadOnly: true
      });
      if (result.success) {
        notifications = result.notifications;
        notificationCount = result.pagination?.unreadCount || 0;
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    }


    
    // Use the notifications directly from the service (already formatted)
    const formattedNotifications = notifications;

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

    // --- Build notifications dropdown HTML (if not already provided by middleware) ---
    let notificationsDropdownHtml = '';
    const unreadCount = notifications.filter(n => !n.read).length;
    if (notifications && notifications.length > 0) {
      let itemsHtml = '';
      const display = notifications.slice(0, 5);
      display.forEach(n => {
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
      const header = `<li class="notification-header">
                        <span>Notifications</span>
                        ${unreadCount > 0 ? `<span class="badge bg-primary rounded-pill">${unreadCount}</span>` : ''}
                      </li>`;
      const markAll = `<li class="mark-all-read" onclick="markAllNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Mark all as read</li>`;
      notificationsDropdownHtml = header + itemsHtml + markAll;
    } else {
      notificationsDropdownHtml = `<li class="notification-empty"><i class="fas fa-bell-slash"></i><p>No notifications</p></li>`;
    }

    res.render('student/dashboard', {
    title: 'Student Dashboard',
    user: student.user,
    student,
    enrollments: student.enrollments,
    upcomingAssignments,
    completedAssignments,
    pendingClassWorks,
    recentClassWorks,
    notifications: formattedNotifications,
    notificationCount,
    userSchool: userSchool,
    isSuperAdmin: isSuperAdmin,
    // Navbar variables (already provided by middleware, but pass them explicitly for safety)
    userRole: student.user.role || 'student',
    userFirstName: student.user.firstName || '',
    userLastName: student.user.lastName || '',
    avatarUrl: avatarUrl || '',
    fallbackAvatar: fallbackAvatar || '',
    notificationsDropdownHtml: notificationsDropdownHtml || ''
});

// Get class assignments for student
const getClassAssignments = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const classId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Verify student is enrolled in this class
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: studentId,
        classId: classId
      },
      include: {
        class: {
          include: {
            teacher: {
              include: { user: true }
            }
          }
        }
      }
    });

    if (!enrollment) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    // Get assignments for this class with student's submissions
    const assignments = await prisma.assignment.findMany({
      where: {
        classId: classId
      },
      include: {
        class: true,
        submissions: {
          where: {
            studentId: studentId
          }
        }
      },
      orderBy: {
        dueDate: 'asc'
      }
    });

    res.render('student/class-assignments', {
      title: 'Class Assignments',
      classData: enrollment.class,
      assignments: assignments,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Get class assignments error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get submission page
const getSubmissionPage = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.id);
    const { type } = req.query;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get assignment and verify student has access
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { studentId: studentId }
            }
          }
        }
      }
    });

    if (!assignment || assignment.class.enrollments.length === 0) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    // Check if assignment is still open
    if (new Date() > new Date(assignment.dueDate)) {
      return res.status(400).render('error/400', { 
        title: 'Assignment Closed',
        message: 'This assignment is past its due date and cannot be submitted.'
      });
    }

    res.render('student/submit-assignment', {
      title: `Submit: ${assignment.title}`,
      assignment: assignment,
      submissionType: type || 'file',
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Get submission page error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Enhanced submission page (rich text/drawing)
const getEnhancedSubmissionPage = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.id);
    const { type } = req.query;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get assignment and verify student has access
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { studentId: studentId }
            }
          }
        }
      }
    });

    if (!assignment || assignment.class.enrollments.length === 0) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    // Check if assignment is still open
    if (new Date() > new Date(assignment.dueDate)) {
      return res.status(400).render('error/400', { 
        title: 'Assignment Closed',
        message: 'This assignment is past its due date and cannot be submitted.'
      });
    }

    const validTypes = ['text', 'drawing'];
    const submissionType = validTypes.includes(type) ? type : 'text';

    res.render('student/submit-enhanced', {
      title: `Submit: ${assignment.title}`,
      assignment: assignment,
      submissionType: submissionType,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Get enhanced submission page error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Submit assignment (file upload)
const submitAssignmentFile = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please select a file to upload'
      });
    }

    // Get assignment and verify student has access
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { studentId: studentId }
            }
          }
        }
      }
    });

    if (!assignment || assignment.class.enrollments.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if assignment is still open
    if (new Date() > new Date(assignment.dueDate)) {
      return res.status(400).json({
        success: false,
        message: 'This assignment is past its due date'
      });
    }

    // Check for existing submission
    const existingSubmission = await prisma.submission.findFirst({
      where: {
        assignmentId: assignmentId,
        studentId: studentId
      }
    });

    if (existingSubmission) {
      // Update existing submission
      await prisma.submission.update({
        where: { id: existingSubmission.id },
        data: {
          fileUrl: req.file.path,
          submittedAt: new Date(),
          grade: null,
          feedback: null
        }
      });
    } else {
      // Create new submission
      await prisma.submission.create({
        data: {
          assignmentId: assignmentId,
          studentId: studentId,
          fileUrl: req.file.path,
          submittedAt: new Date()
        }
      });
    }

    res.json({
      success: true,
      message: 'Assignment submitted successfully!'
    });
  } catch (error) {
    console.error('Submit assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit assignment'
    });
  }
};

// Submit enhanced assignment (text/drawing)
const submitEnhancedAssignment = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.id);
    const { content, type } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Submission content is required'
      });
    }

    // Get assignment and verify student has access
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { studentId: studentId }
            }
          }
        }
      }
    });

    if (!assignment || assignment.class.enrollments.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if assignment is still open
    if (new Date() > new Date(assignment.dueDate)) {
      return res.status(400).json({
        success: false,
        message: 'This assignment is past its due date'
      });
    }

    // Check for existing submission
    const existingSubmission = await prisma.submission.findFirst({
      where: {
        assignmentId: assignmentId,
        studentId: studentId
      }
    });

    const submissionData = {
      content: content,
      submittedAt: new Date(),
      submissionType: type || 'text',
      grade: null,
      feedback: null
    };

    if (existingSubmission) {
      // Update existing submission
      await prisma.submission.update({
        where: { id: existingSubmission.id },
        data: submissionData
      });
    } else {
      // Create new submission
      await prisma.submission.create({
        data: {
          assignmentId: assignmentId,
          studentId: studentId,
          ...submissionData
        }
      });
    }

    res.json({
      success: true,
      message: 'Assignment submitted successfully!'
    });
  } catch (error) {
    console.error('Submit enhanced assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit assignment'
    });
  }
};

// View materials
const viewMaterials = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const classId = req.params.classId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log('🔍 ViewMaterials called:', { studentId, classId, userSchool });

    if (!studentId) {
      return res.status(401).render('error/401', { title: 'Unauthorized' });
    }

    // Verify student is enrolled in the class
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: classId,
          studentId: studentId
        }
      }
    });

    if (!enrollment) {
      return res.status(403).render('error/403', { 
        title: 'Access Denied',
        message: 'You are not enrolled in this class'
      });
    }

    // Get class details
    const classDetails = await prisma.class.findUnique({
      where: { 
        id: classId
      },
      include: {
        teacher: {
          include: {
            user: true
          }
        }
      }
    });

    if (!classDetails) {
      return res.status(404).render('error/404', { title: 'Class Not Found' });
    }

    // Then get materials
    const materials = await prisma.material.findMany({
      where: {
        classId: classId,
        OR: [
          { isPublic: true },
          { classId: classId }
        ]
      },
      include: {
        class: true,
        teacher: {
          include: {
            user: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log('✅ Materials loaded:', materials.length);

    res.render('student/materials', {
      title: `Materials - ${classDetails.name}`,
      materials: materials || [],
      classData: classDetails,
      user: req.session.user,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('❌ View materials error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      message: 'Failed to load materials. Please try again.' 
    });
  }
};

// View assignments
const viewAssignments = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const classId = req.params.classId; // DON'T PARSE AS INTEGER
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log('📝 View assignments called:', { studentId, classId, userSchool });

    // Validate classId
    if (!classId || typeof classId !== 'string' || classId.trim() === '') {
      return res.status(400).render('error/400', { 
        title: 'Bad Request',
        message: 'Invalid class ID provided'
      });
    }

    // Verify student is enrolled in the class
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: classId, // Keep as string
          studentId: studentId
        }
      }
    });

    if (!enrollment) {
      return res.status(403).render('error/403', { 
        title: 'Access Denied',
        message: 'You are not enrolled in this class'
      });
    }

    // Get assignments for the class
    const assignments = await prisma.assignment.findMany({
      where: { 
        classId: classId // Keep as string
      },
      include: {
        class: true,
        submissions: {
          where: { studentId: studentId }
        }
      },
      orderBy: {
        dueDate: 'asc'
      }
    });

    // Get class details
    const classDetails = await prisma.class.findUnique({
      where: { id: classId }, // Keep as string
      include: {
        teacher: {
          include: { user: true }
        }
      }
    });

    if (!classDetails) {
      return res.status(404).render('error/404', { title: 'Class Not Found' });
    }

    res.render('student/assignments', {
      title: `Assignments - ${classDetails.name}`,
      assignments: assignments,
      classData: classDetails,
      studentId: studentId,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('❌ View assignments error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      message: 'Failed to load assignments. Please try again.' 
    });
  }
};

// Get submit assignment page
const getSubmitAssignment = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.assignmentId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get assignment details
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { studentId: studentId }
            }
          }
        },
        submissions: {
          where: { studentId: studentId }
        }
      }
    });

    if (!assignment) {
      return res.status(404).render('error/404', { title: 'Assignment Not Found' });
    }

    // Verify student is enrolled in the class
    if (assignment.class.enrollments.length === 0) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    res.render('student/submit-assignment', {
      title: `Submit Assignment - ${assignment.title}`,
      assignment: assignment,
      hasSubmission: assignment.submissions.length > 0,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Get submit assignment error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Submit assignment
const submitAssignment = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.assignmentId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('📤 Submitting assignment:', { assignmentId, studentId });
    
    // Check if assignment exists and is not past due
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { studentId: studentId }
            }
          }
        }
      }
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    if (new Date() > assignment.dueDate) {
      return res.status(400).json({
        success: false,
        message: 'This assignment is past the due date and cannot be submitted.'
      });
    }

    // Check if there's a file or text content
    const hasFile = req.file && req.file.path;
    const hasText = req.body.content && req.body.content.trim().length > 0;
    
    if (!hasFile && !hasText) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a file or text content for your submission.'
      });
    }

    // Prepare submission data
    const submissionData = {
      submittedAt: new Date(),
      status: 'submitted'
    };

    if (hasFile) {
      submissionData.fileUrl = req.file.path;
      submissionData.submissionType = 'file';
    }

    if (hasText) {
      submissionData.content = req.body.content;
      submissionData.submissionType = req.body.type || 'text';
      if (req.body.title) {
        submissionData.textTitle = req.body.title;
      }
    }

    // Create or update submission
    await prisma.submission.upsert({
      where: {
        assignmentId_studentId: {
          assignmentId,
          studentId
        }
      },
      update: submissionData,
      create: {
        assignmentId,
        studentId,
        ...submissionData
      }
    });

    // Return success
    return res.json({
      success: true,
      message: 'Assignment submitted successfully!',
      redirectUrl: `/student/class/${assignment.class.id}/assignments`
    });

  } catch (error) {
    console.error('❌ Submit assignment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit assignment. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// View classes
const viewClasses = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Get student with enrollments and classes
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: true,
        enrollments: {
          include: {
            class: {
              include: {
                teacher: {
                  include: { user: true }
                },
                assignments: {
                  where: {
                    dueDate: {
                      gt: new Date()
                    }
                  },
                  orderBy: {
                    dueDate: 'asc'
                  },
                  take: 5
                }
              }
            }
          }
        }
      }
    });

    if (!student) {
      return res.status(404).render('error/404', { title: 'Student Not Found' });
    }

    // Filter out any enrollments with missing class data
    const validEnrollments = student.enrollments.filter(enrollment => 
      enrollment.class && enrollment.class.id
    );

    // Calculate upcoming assignments across all classes
    let upcomingAssignments = [];
    validEnrollments.forEach(enrollment => {
      if (enrollment.class.assignments && enrollment.class.assignments.length > 0) {
        enrollment.class.assignments.forEach(assignment => {
          upcomingAssignments.push({
            ...assignment,
            className: enrollment.class.name,
            classId: enrollment.class.id
          });
        });
      }
    });

    // Sort upcoming assignments by due date
    upcomingAssignments.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    // Get completed assignments count
    const completedAssignments = await prisma.submission.count({
      where: {
        studentId: studentId,
        grade: {
          not: null
        }
      }
    });

    res.render('student/classes', {
      title: 'My Classes',
      user: student.user,
      enrollments: validEnrollments,
      upcomingAssignments: upcomingAssignments.slice(0, 10),
      completedAssignments: completedAssignments,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('View classes error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// View all assignments across all classes
const viewAllAssignments = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Get student with enrollments to find class IDs
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        enrollments: {
          include: {
            class: true
          }
        }
      }
    });

    const classIds = student.enrollments.map(e => e.classId);
    
    // Get all assignments for the student's classes
    const assignments = await prisma.assignment.findMany({
      where: {
        classId: {
          in: classIds
        }
      },
      include: {
        class: true,
        teacher: {
          include: { user: true }
        },
        submissions: {
          where: { studentId: studentId }
        }
      },
      orderBy: {
        dueDate: 'asc'
      }
    });

    res.render('student/all-assignments', {
      title: 'All Assignments',
      assignments: assignments,
      studentId: studentId,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('View all assignments error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// View all grades across all classes
const viewAllGrades = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Get all graded submissions
    const gradedSubmissions = await prisma.submission.findMany({
      where: {
        studentId: studentId,
        grade: { not: null }
      },
      include: {
        assignment: {
          include: {
            class: true,
            teacher: {
              include: { user: true }
            }
          }
        }
      },
      orderBy: {
        submittedAt: 'desc'
      }
    });

    res.render('student/all-grades', {
      title: 'All Grades',
      submissions: gradedSubmissions,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('View all grades error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// View exams for a class
const viewExams = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const classId = req.params.classId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Verify student is enrolled in the class
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: classId,
          studentId: studentId
        }
      }
    });

    if (!enrollment) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    // Simple exam query without complex relations
    const exams = await prisma.exam.findMany({
      where: { 
        classId: classId
      },
      select: {
        id: true,
        title: true,
        description: true,
        date: true,
        duration: true,
        maxAttempts: true,
        showResults: true,
        isActive: true,
        createdAt: true,
        teacher: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        attempts: {
          where: { studentId: studentId },
          select: {
            id: true,
            score: true,
            status: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });

    // Format exams data for the view
    const formattedExams = exams.map(exam => {
      const now = new Date();
      const examDate = new Date(exam.date);
      const endTime = new Date(examDate.getTime() + (exam.duration * 60000));
      
      let status = 'upcoming';
      if (now >= examDate && now <= endTime) {
        status = 'ongoing';
      } else if (now > endTime || exam.attempts.length > 0) {
        status = 'completed';
      }

      return {
        ...exam,
        status,
        totalQuestions: 0,
        hasAttempt: exam.attempts.length > 0,
        score: exam.attempts.length > 0 ? exam.attempts[0].score : null
      };
    });

    // Get class details
    const classDetails = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: { user: true }
        }
      }
    });

    res.render('student/exam', { 
      title: 'Class Exams',
      exams: formattedExams, 
      classData: classDetails,
      classId: classId,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('View exams error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Take exam - display exam questions
const takeExam = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const examId = parseInt(req.params.examId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get exam
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        class: true,
        teacher: {
          include: { user: true }
        }
      }
    });

    if (!exam) {
      return res.status(404).render('error/404', { title: 'Exam Not Found' });
    }

    // Check if student is enrolled in the class
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: exam.classId,
          studentId: studentId
        }
      }
    });

    if (!enrollment) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    // Check if exam is available
    const now = new Date();
    const examDate = new Date(exam.date);
    const endTime = new Date(examDate.getTime() + (exam.duration * 60000));

    if (now < examDate) {
      return res.status(400).render('error/400', {
        title: 'Exam Not Available',
        message: 'This exam has not started yet.'
      });
    }

    if (now > endTime) {
      return res.status(400).render('error/400', {
        title: 'Exam Expired',
        message: 'This exam has already ended.'
      });
    }

    // Check for existing attempt
    const existingAttempt = await prisma.examAttempt.findFirst({
      where: {
        examId: examId,
        studentId: studentId
      }
    });

    if (existingAttempt && existingAttempt.status === 'submitted') {
      return res.redirect(`/student/exams/${existingAttempt.id}/results`);
    }

    let attempt = existingAttempt;
    if (!existingAttempt) {
      attempt = await prisma.examAttempt.create({
        data: {
          examId: examId,
          studentId: studentId,
          startedAt: new Date(),
          status: 'in_progress'
        }
      });
    }

    // Get questions from the exam data
    const questions = exam.questions || [];

    res.render('student/take-exam', {
      title: `Exam: ${exam.title}`,
      exam: exam,
      attempt: attempt,
      questions: questions,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('Take exam error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Submit exam
const submitExam = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const examId = parseInt(req.params.examId);
    const { answers, timeSpent } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get exam with questions
    const exam = await prisma.exam.findUnique({
      where: { 
        id: examId
      },
      include: {
        teacher: {
          include: {
            user: true
          }
        }
      }
    });

    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    // Find current attempt
    const attempt = await prisma.examAttempt.findFirst({
      where: {
        examId: examId,
        studentId: studentId,
        status: 'in_progress'
      }
    });

    if (!attempt) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    // Calculate score based on answers
    let score = 0;
    const questions = exam.questions || [];
    const totalQuestions = questions.length;

    if (questions.length > 0 && answers) {
      questions.forEach((question, index) => {
        const studentAnswer = answers[index];
        if (studentAnswer !== undefined && studentAnswer !== null) {
          if (question.type === 'multiple_choice' || question.type === 'true_false') {
            if (studentAnswer === question.correctAnswer) {
              score += question.marks || 1;
            }
          } else if (question.type === 'short_answer') {
            if (studentAnswer.trim().length > 0) {
              score += (question.marks || 1) * 0.5;
            }
          }
        }
      });
    }

    // Update attempt with score and submission
    const updatedAttempt = await prisma.examAttempt.update({
      where: { id: attempt.id },
      data: {
        answers: answers,
        score: score,
        submittedAt: new Date(),
        status: 'submitted',
        timeSpent: parseInt(timeSpent) || 0
      }
    });

    res.json({ 
      success: true, 
      score: score,
      totalQuestions: totalQuestions,
      attemptId: updatedAttempt.id
    });

  } catch (error) {
    console.error('Submit exam error:', error);
    res.status(500).json({ error: 'Failed to submit exam' });
  }
};

// View exam results
const viewExamResults = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const attemptId = parseInt(req.params.attemptId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            class: true
          }
        }
      }
    });

    if (!attempt || attempt.studentId !== studentId) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    // Calculate total marks
    let totalMarks = 100;
    
    if (attempt.exam.totalMarks) {
      totalMarks = attempt.exam.totalMarks;
    } else {
      if (attempt.exam.questions && Array.isArray(attempt.exam.questions)) {
        totalMarks = attempt.exam.questions.reduce((total, question) => {
          return total + (question.marks || 1);
        }, 0);
      }
    }

    // Calculate percentage
    const percentage = attempt.score ? (attempt.score / totalMarks) * 100 : 0;

    res.render('student/exam-results', {
      title: 'Exam Results',
      attempt: attempt,
      exam: attempt.exam,
      totalMarks: totalMarks,
      percentage: percentage.toFixed(1),
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('View exam results error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// API: Get exam questions for student
const getExamQuestions = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const examId = parseInt(req.params.examId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        class: true,
        teacher: {
          include: { user: true }
        }
      }
    });

    if (!exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    // Verify enrollment
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: exam.classId,
          studentId: studentId
        }
      }
    });

    if (!enrollment) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        duration: exam.duration,
        date: exam.date,
        className: exam.class.name,
        teacherName: `${exam.teacher.user.firstName} ${exam.teacher.user.lastName}`
      },
      questions: exam.questions || []
    });

  } catch (error) {
    console.error('Get exam questions error:', error);
    res.status(500).json({ error: 'Failed to load exam questions' });
  }
};

// Get enhanced submit assignment page
const getEnhancedSubmitAssignment = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const assignmentId = req.params.assignmentId; // DON'T PARSE AS INTEGER
        const submissionType = req.query.type || 'text';
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log('📝 Enhanced submission requested:', { assignmentId, submissionType });

        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId }, // Keep as string
            include: {
                class: {
                    include: {
                        enrollments: {
                            where: { studentId: studentId }
                        }
                    }
                },
                submissions: {
                    where: { studentId: studentId }
                }
            }
        });

        if (!assignment) {
            return res.status(404).render('error/404', { title: 'Assignment Not Found' });
        }

        // Verify student is enrolled in the class
        if (assignment.class.enrollments.length === 0) {
            return res.status(403).render('error/403', { title: 'Access Denied' });
        }

        // Check if assignment is past due
        if (new Date() > new Date(assignment.dueDate)) {
            return res.status(400).render('error/400', {
                title: 'Assignment Past Due',
                message: 'This assignment is past the due date and cannot be submitted.'
            });
        }

        // Render text submission form
        res.render('student/submit-text', {
            title: `Submit Assignment - ${assignment.title}`,
            assignment: assignment,
            hasSubmission: assignment.submissions.length > 0,
            submissionType: submissionType,
            userSchool: userSchool,
            isSuperAdmin: isSuperAdmin
        });
    } catch (error) {
        console.error('Get enhanced submit assignment error:', error);
        res.status(500).render('error/500', { title: 'Server Error' });
    }
};

// Submit text assignment
const submitTextAssignment = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const assignmentId = req.params.assignmentId; // Already a string
        const { title, content } = req.body;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log('📝 Text submission received:', { 
            assignmentId, 
            title, 
            contentLength: content?.length,
            body: req.body,
            files: req.files
        });

        // Debug: Check what's in req.body
        console.log('🔍 Request body:', req.body);
        console.log('🔍 Request files:', req.files);

        // Validate input
        if (!title || !content) {
            return res.status(400).json({
                success: false,
                message: 'Title and content are required'
            });
        }

        // Check if assignment exists and is not past due
        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId },
            include: {
                class: {
                    include: {
                        enrollments: {
                            where: { studentId: studentId }
                        }
                    }
                }
            }
        });

        if (!assignment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Assignment not found' 
            });
        }

        if (new Date() > new Date(assignment.dueDate)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Assignment is past due date' 
            });
        }

        // Calculate word count
        const textContent = content.replace(/<[^>]*>/g, ' ');
        const wordCount = textContent.split(/\s+/).filter(word => word.length > 0).length;

        // Create or update submission
        const submission = await prisma.submission.upsert({
            where: {
                assignmentId_studentId: {
                    assignmentId,
                    studentId
                }
            },
            update: {
                submittedAt: new Date(),
                submissionType: 'text',
                content: content,
                textTitle: title,
                wordCount: wordCount,
                status: 'submitted'
            },
            create: {
                assignmentId,
                studentId,
                submittedAt: new Date(),
                submissionType: 'text',
                content: content,
                textTitle: title,
                wordCount: wordCount,
                status: 'submitted'
            }
        });

        console.log('✅ Text assignment submitted successfully:', submission.id);

        res.json({ 
            success: true, 
            message: 'Assignment submitted successfully',
            redirectUrl: `/student/class/${assignment.class.id}/assignments`
        });

    } catch (error) {
        console.error('❌ Submit text assignment error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to submit assignment',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Submit drawing assignment
const submitDrawingAssignment = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const assignmentId = parseInt(req.params.assignmentId);
        const { title, imageData } = req.body;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log('🎨 Drawing submission received:', { assignmentId, title, imageDataLength: imageData?.length });

        // Validate input
        if (!title || !imageData) {
            return res.status(400).json({
                success: false,
                message: 'Title and drawing data are required'
            });
        }

        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId },
            include: {
                class: {
                    include: {
                        enrollments: {
                            where: { studentId: studentId }
                        }
                    }
                }
            }
        });

        if (!assignment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Assignment not found' 
            });
        }

        if (new Date() > new Date(assignment.dueDate)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Assignment is past due date' 
            });
        }

        // Create or update submission
        const submission = await prisma.submission.upsert({
            where: {
                assignmentId_studentId: {
                    assignmentId,
                    studentId
                }
            },
            update: {
                submittedAt: new Date(),
                submissionType: 'drawing',
                drawingData: imageData,
                textTitle: title,
                status: 'submitted'
            },
            create: {
                assignmentId,
                studentId,
                submittedAt: new Date(),
                submissionType: 'drawing',
                drawingData: imageData,
                textTitle: title,
                status: 'submitted'
            }
        });

        console.log('✅ Drawing assignment submitted successfully:', submission.id);

        res.json({ 
            success: true, 
            message: 'Drawing assignment submitted successfully',
            redirectUrl: `/student/class/${assignment.class.id}/assignments`
        });

    } catch (error) {
        console.error('❌ Submit drawing assignment error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to submit drawing',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// ========== NOTES MANAGEMENT FUNCTIONS ==========

// Get notes for a class
const getNotes = async (req, res) => {
    try {
        console.log('🔍 getNotes called with params:', req.params);
        
        const studentId = req.session.user.studentId;
        const classId = parseInt(req.params.classId);
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log('🔍 Parsed values:', { studentId, classId });

        // Validate inputs
        if (isNaN(classId)) {
            console.log('❌ Invalid classId:', req.params.classId);
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid class ID' 
            });
        }

        if (!studentId) {
            console.log('❌ No studentId in session');
            return res.status(401).json({ 
                success: false, 
                message: 'Not authenticated' 
            });
        }

        // Verify enrollment
        const enrollment = await prisma.enrollment.findUnique({
            where: {
                classId_studentId: {
                    classId: classId,
                    studentId: studentId
                }
            }
        });

        if (!enrollment) {
            console.log('❌ Student not enrolled in class');
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied: You are not enrolled in this class' 
            });
        }

        // Fetch notes
        const notes = await prisma.studentNote.findMany({
            where: {
                classId: classId,
                studentId: studentId
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        console.log('✅ Notes found:', notes.length);

        // Parse content safely
        const parsedNotes = notes.map(note => {
            try {
                let content = note.content;
                if (typeof content === 'string') {
                    try {
                        content = JSON.parse(content);
                    } catch (parseError) {
                        console.log('Note content is plain text, not JSON');
                    }
                }
                return {
                    ...note,
                    content: content
                };
            } catch (error) {
                console.error('Error processing note:', error);
                return note;
            }
        });

        res.json({ 
            success: true, 
            notes: parsedNotes 
        });
    } catch (error) {
        console.error('❌ Error in getNotes:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch notes',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Save a new note
const saveNote = async (req, res) => {
    try {
        console.log('💾 saveNote called with body:', req.body);
        
        const studentId = req.session.user.studentId;
        const classId = parseInt(req.params.classId);
        const { title, content, type } = req.body;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log('💾 Parsed values:', { studentId, classId, title, type });

        // Validate inputs
        if (isNaN(classId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid class ID'
            });
        }

        if (!title || !content) {
            return res.status(400).json({
                success: false,
                message: 'Title and content are required'
            });
        }

        if (!studentId) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        // Verify enrollment
        const enrollment = await prisma.enrollment.findUnique({
            where: {
                classId_studentId: {
                    classId: classId,
                    studentId: studentId
                }
            }
        });

        if (!enrollment) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: You are not enrolled in this class'
            });
        }

        // Process content based on type
        let processedContent;
        try {
            switch (type) {
                case 'text':
                case 'quick':
                    processedContent = typeof content === 'string' ? content : JSON.stringify(content);
                    break;
                case 'drawing':
                    processedContent = content;
                    break;
                case 'mixed':
                    if (typeof content === 'object') {
                        processedContent = content;
                    } else {
                        processedContent = { text: content, drawing: null };
                    }
                    break;
                default:
                    processedContent = content;
            }

            // Always store as JSON string for consistency
            const contentToStore = typeof processedContent === 'string' 
                ? processedContent 
                : JSON.stringify(processedContent);

            const note = await prisma.studentNote.create({
                data: {
                    title: title.trim(),
                    content: contentToStore,
                    type: type || 'text',
                    studentId,
                    classId: classId
                }
            });

            console.log('✅ Note saved successfully:', note.id);

            // Parse content for response
            let responseContent;
            try {
                responseContent = typeof note.content === 'string' 
                    ? JSON.parse(note.content) 
                    : note.content;
            } catch {
                responseContent = note.content;
            }

            res.json({ 
                success: true, 
                message: 'Note saved successfully',
                note: {
                    ...note,
                    content: responseContent
                },
                reloadPage: true
            });

        } catch (dbError) {
            console.error('❌ Database error saving note:', dbError);
            throw dbError;
        }

    } catch (error) {
        console.error('❌ Error saving note:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to save note',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Delete a note
const deleteNote = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const noteId = parseInt(req.params.noteId);
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        // Verify the note belongs to the student
        const note = await prisma.studentNote.findFirst({
            where: {
                id: noteId,
                studentId: studentId
            }
        });

        if (!note) {
            return res.status(404).json({
                success: false,
                message: 'Note not found or access denied'
            });
        }

        await prisma.studentNote.delete({
            where: {
                id: noteId
            }
        });

        res.json({ 
            success: true, 
            message: 'Note deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to delete note' 
        });
    }
};

// Update note
const updateNote = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const noteId = parseInt(req.params.noteId);
        const { title, content } = req.body;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        // Verify the note belongs to the student
        const existingNote = await prisma.studentNote.findFirst({
            where: {
                id: noteId,
                studentId: studentId
            }
        });

        if (!existingNote) {
            return res.status(404).json({
                success: false,
                message: 'Note not found or access denied'
            });
        }

        const updatedNote = await prisma.studentNote.update({
            where: {
                id: noteId
            },
            data: {
                title,
                content: JSON.stringify(content),
                updatedAt: new Date()
            }
        });

        res.json({ 
            success: true, 
            message: 'Note updated successfully',
            note: {
                ...updatedNote,
                content: JSON.parse(updatedNote.content)
            }
        });
    } catch (error) {
        console.error('Error updating note:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update note' 
        });
    }
};

// Download material file - WITH DEBUGGING
const downloadMaterial = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const materialId = req.params.materialId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('📥 Download request for material:', materialId, 'by student:', studentId);

    // Validate materialId
    if (!materialId || typeof materialId !== 'string' || materialId.trim() === '') {
      console.log('❌ Invalid materialId:', materialId);
      return res.status(400).render('error/400', { 
        title: 'Bad Request',
        message: 'Invalid material ID provided.'
      });
    }

    // Get material with access control
    const material = await prisma.material.findUnique({
      where: { 
        id: materialId
      },
      include: {
        class: {
          include: {
            enrollments: {
              where: { 
                studentId: studentId
              }
            }
          }
        }
      }
    });

    if (!material) {
      console.log('❌ Material not found in database');
      return res.status(404).render('error/404', { title: 'Material Not Found' });
    }

    console.log('✅ Material found:', {
      id: material.id,
      title: material.title,
      fileUrl: material.fileUrl,
      type: material.type
    });

    // Check access: either public material, or student is enrolled in the class
    const hasAccess = material.isPublic || 
                     (material.class && material.class.enrollments.length > 0);

    if (!hasAccess) {
      console.log('❌ Student does not have access to this material');
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    // Check if file exists
    const fs = require('fs');
    const path = require('path');
    
    console.log('🔍 Checking file path:', material.fileUrl);
    
    // Check if the file path is relative or absolute
    let filePath = material.fileUrl;
    
    // If it's an absolute path starting with /uploads, check if it exists
    if (filePath.startsWith('/uploads/')) {
      // Try to construct the full path from project root
      const projectRoot = process.cwd(); // Gets the current working directory
      const absolutePath = path.join(projectRoot, filePath);
      console.log('📁 Trying absolute path from project root:', absolutePath);
      
      if (fs.existsSync(absolutePath)) {
        filePath = absolutePath;
      } else if (fs.existsSync(filePath)) {
        // Try the path as-is
        console.log('📁 File exists at original path');
      } else {
        // Try looking in the public/uploads directory
        const publicPath = path.join(projectRoot, 'public', filePath);
        console.log('📁 Trying public directory path:', publicPath);
        
        if (fs.existsSync(publicPath)) {
          filePath = publicPath;
        } else {
          // Try just the filename in uploads directory
          const fileName = path.basename(filePath);
          const uploadsDir = path.join(projectRoot, 'uploads', 'materials', fileName);
          console.log('📁 Trying uploads directory:', uploadsDir);
          
          if (fs.existsSync(uploadsDir)) {
            filePath = uploadsDir;
          } else {
            console.log('❌ File not found at any of the checked paths');
            return res.status(404).render('error/404', { 
              title: 'File Not Found',
              message: 'The requested file could not be found on the server.'
            });
          }
        }
      }
    }
    
    console.log('✅ Using file path:', filePath);
    
    if (!fs.existsSync(filePath)) {
      console.log('❌ File not found at final path:', filePath);
      return res.status(404).render('error/404', { 
        title: 'File Not Found',
        message: 'The requested file could not be found on the server.'
      });
    }

    // Get proper filename for download
    const filename = path.basename(filePath);
    const fileExtension = path.extname(filePath);
    const originalFilename = material.title + fileExtension;
    
    // Set appropriate content type based on file extension
    const contentType = getContentType(fileExtension);
    
    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
    res.setHeader('Content-Type', contentType);
    
    console.log('✅ Streaming file:', filePath);
    console.log('📤 Headers:', {
      'Content-Disposition': `attachment; filename="${originalFilename}"`,
      'Content-Type': contentType
    });
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('❌ Download material error:', error);
    res.status(500).render('error/500', { title: 'Download Error' });
  }
};

// Helper function to get content type
function getContentType(extension) {
  const contentTypes = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.txt': 'text/plain',
    '.zip': 'application/zip'
  };
  
  return contentTypes[extension.toLowerCase()] || 'application/octet-stream';
}

// ========== CLASS WORKS FUNCTIONS ==========

// Get class works for a specific class
const viewClassWorks = async (req, res) => {
  try {
    // Extract parameters correctly
    const { classId } = req.params; // This is a string
    const studentId = req.session.user?.studentId || req.session.studentId;
    
    // Get school context
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Debug logging
    console.log(`📚 Fetching class works for class: ${classId}, student: ${studentId}`);

    // Validate classId as string
    if (!classId || typeof classId !== 'string' || classId.trim() === '') {
      console.error('❌ Invalid classId:', classId);
      return res.status(400).render('error/400', {
        title: 'Bad Request',
        message: 'Invalid class ID provided'
      });
    }
    
    // Validate studentId
    if (!studentId) {
      console.error('❌ No studentId found in session');
      return res.status(401).render('error/401', {
        title: 'Unauthorized',
        message: 'Student ID not found in session. Please log in again.'
      });
    }

    // Verify enrollment - classId is a string
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: classId, // Keep as string
          studentId: studentId
        }
      }
    });

    if (!enrollment) {
      return res.status(403).render('error/403', { 
        title: 'Access Denied',
        message: 'You are not enrolled in this class'
      });
    }

    // FIXED: Get class works with submissions (removed problematic _count field)
    const classWorks = await prisma.classWork.findMany({
      where: {
        classId: classId,
        isActive: true
      },
      include: {
        class: {
          select: {
            name: true,
            grade: true,
            section: true
          }
        },
        teacher: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        submissions: {
          where: {
            studentId: studentId
          },
          select: {
            id: true,
            score: true,
            status: true,
            submittedAt: true,
            gradedAt: true,
            feedback: true
          }
        }
      },
      orderBy: [
        {
          dueDate: "asc"
        },
        {
          createdAt: "desc"
        }
      ]
    });

    // Get class details
    const classData = await prisma.class.findUnique({
      where: { id: classId }, // Keep as string
      include: {
        teacher: {
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

    console.log('✅ Class works loaded:', classWorks.length);

    // Render the view with data
    return res.render('student/class-works', {
      title: `Class Works - ${classData?.name || 'Class'}`,
      classId: classId,
      classWorks: classWorks,
      classData: classData,
      currentPage: 'class-works',
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
    
  } catch (error) {
    console.error('❌ Error in viewClassWorks:', error);
    return res.status(500).render('error/500', {
      title: 'Server Error',
      message: 'An error occurred while fetching class works',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Take class work
const takeClassWork = async (req, res) => {
  try {
    const studentId = req.session.user?.studentId || req.user?.studentId;
    const classWorkId = req.params.classWorkId || req.params.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`✏️ Taking class work: ${classWorkId}, student: ${studentId}`);

    // Validate parameters
    if (!classWorkId || !studentId) {
      console.error('❌ Missing parameters:', { classWorkId, studentId });
      return res.status(400).render('error/400', {
        title: 'Bad Request',
        message: 'Missing required parameters'
      });
    }

    // Get class work with class and enrollment check
    const classWork = await prisma.classWork.findUnique({
      where: { 
        id: classWorkId
      },
      include: {
        class: {
          include: {
            enrollments: {
              where: { 
                studentId: studentId 
              }
            }
          }
        },
        teacher: {
          include: { 
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!classWork) {
      console.error('❌ Class work not found:', classWorkId);
      return res.status(404).render('error/404', { 
        title: 'Class Work Not Found',
        message: 'The requested class work could not be found.' 
      });
    }

    // Verify enrollment
    if (!classWork.class.enrollments || classWork.class.enrollments.length === 0) {
      console.error('❌ Student not enrolled:', { classWorkId, studentId });
      return res.status(403).render('error/403', {
        title: 'Access Denied',
        message: 'You are not enrolled in this class.'
      });
    }

    // Check for existing submission
    const existingSubmission = await prisma.classWorkSubmission.findFirst({
      where: {
        classWorkId: classWorkId,
        studentId: studentId
      }
    });

    if (existingSubmission && existingSubmission.status === 'submitted') {
      console.log('📋 Redirecting to results for existing submission');
      return res.redirect(`/student/class-works/${classWorkId}/results`);
    }

    // Check if due date has passed
    if (classWork.dueDate && new Date() > new Date(classWork.dueDate)) {
      console.log('⏰ Class work is past due date');
      return res.status(400).render('error/400', {
        title: 'Class Work Expired',
        message: 'This class work is past its due date and cannot be taken.'
      });
    }

    // Get class work with questions (REMOVED: duration field)
    const classWorkWithQuestions = await prisma.classWork.findUnique({
      where: { id: classWorkId },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        points: true,
        // REMOVED: duration: true, - because the ClassWork model doesn't have a duration field
        dueDate: true,
        questions: true,
        classId: true,
        createdAt: true
      }
    });

    if (!classWorkWithQuestions) {
      return res.status(404).render('error/404', { 
        title: 'Class Work Not Found',
        message: 'Could not load class work questions.' 
      });
    }

    console.log('✅ Rendering take-class-work view');
    res.render('student/take-class-work', {
      title: `Class Work: ${classWork.title}`,
      classWork: classWorkWithQuestions,
      classId: classWork.classId,
      hasSubmission: !!existingSubmission,
      userSchool: userSchool || 'Unknown School',
      isSuperAdmin: isSuperAdmin || false
    });

  } catch (error) {
    console.error('❌ Error in takeClassWork:', error);
    res.status(500).render('error/500', {
      title: 'Server Error',
      message: 'An error occurred while loading the class work.'
    });
  }
};

// Submit class work
const submitClassWork = async (req, res) => {
  try {
    const studentId = req.session.user?.studentId;
    const classWorkId = req.params.classWorkId; // Already a string
    const { answers } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`📤 Submitting class work: ${classWorkId}, student: ${studentId}`);

    // Get class work
    const classWork = await prisma.classWork.findUnique({
      where: { 
        id: classWorkId
      }
    });

    if (!classWork) {
      return res.status(404).json({ success: false, message: 'Class work not found' });
    }

    // Calculate score (basic implementation)
    let score = 0;
    const questions = classWork.questions || [];
    
    if (questions.length > 0 && answers) {
      questions.forEach((question, index) => {
        const studentAnswer = answers[index];
        if (studentAnswer && question.correctAnswer && studentAnswer === question.correctAnswer) {
          score += question.points || 1;
        }
      });
    }

    // Check if submission already exists
    const existingSubmission = await prisma.classWorkSubmission.findFirst({
      where: {
        classWorkId: classWorkId,
        studentId: studentId
      }
    });

    let submission;
    if (existingSubmission) {
      // Update existing submission
      submission = await prisma.classWorkSubmission.update({
        where: { id: existingSubmission.id },
        data: {
          answers: answers,
          score: score,
          submittedAt: new Date(),
          status: 'submitted'
        }
      });
    } else {
      // Create new submission
      submission = await prisma.classWorkSubmission.create({
        data: {
          classWorkId: classWorkId,
          studentId: studentId,
          answers: answers,
          score: score,
          submittedAt: new Date(),
          status: 'submitted'
        }
      });
    }

    res.json({
      success: true,
      message: 'Class work submitted successfully!',
      submissionId: submission.id,
      score: score,
      totalPoints: questions.reduce((total, q) => total + (q.points || 1), 0)
    });

  } catch (error) {
    console.error('❌ Error in submitClassWork:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit class work'
    });
  }
};

// View class work results
const viewClassWorkResults = async (req, res) => {
  try {
     const studentId = req.session.user.studentId;
    const classWorkId = req.params.classWorkId; 
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`📊 Viewing results for class work: ${classWorkId}, student: ${studentId}`);

    // Get submission with class work details
    const submission = await prisma.classWorkSubmission.findUnique({
      where: {
        classWorkId_studentId: {
          classWorkId: classWorkId,
          studentId: studentId
        }
      },
      include: {
        classWork: {
          include: {
            class: true,
            teacher: {
              include: { user: true }
            }
          }
        }
      }
    });

    if (!submission) {
      return res.status(404).render('error/404', { title: 'Submission Not Found' });
    }

    // Calculate results
    const results = {
      score: submission.score || 0,
      totalQuestions: submission.classWork.questions?.length || 0,
      correctAnswers: Math.round((submission.score || 0) / (submission.classWork.questions?.[0]?.points || 1)),
      submittedAt: submission.submittedAt
    };

    res.render('student/class-work-results', {
      title: `Results - ${submission.classWork.title}`,
      results,
      submission: submission,
      classWork: submission.classWork,
      classWorkId,
      currentPage: 'class-works',
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('❌ Error in viewClassWorkResults:', error);
    res.status(500).render('error/500', {
      error: 'Failed to load class work results',
      message: error.message
    });
  }
};

// ========== LIVE SESSIONS FUNCTIONS ==========

// Get live sessions for a specific class
const viewLiveSessions = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const classId = req.params.classId; // DON'T USE parseInt() - keep as string
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`🎥 Fetching live sessions for class: ${classId}, student: ${studentId}`);

    // Verify enrollment - classId is a string
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: classId, // Keep as string
          studentId: studentId
        }
      }
    });

    if (!enrollment) {
      return res.status(403).render('error/403', { 
        title: 'Access Denied',
        message: 'You are not enrolled in this class'
      });
    }

    // Get live sessions with participation status
    const liveSessions = await prisma.liveSession.findMany({
      where: {
        classId: classId, // Keep as string
        isActive: true
      },
      include: {
        class: {
          select: {
            name: true,
            grade: true,
            section: true
          }
        },
        teacher: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        participants: {
          where: { 
            studentId: studentId 
          },
          select: {
            id: true,
            joinedAt: true,
            leftAt: true,
            duration: true
          }
        }
      },
      orderBy: [
        { startTime: 'desc' }
      ]
    });

    // Get class details
    const classData = await prisma.class.findUnique({
      where: { id: classId }, // Keep as string
      include: {
        teacher: {
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

    console.log('✅ Live sessions loaded:', liveSessions.length);

    res.render('student/live-sessions', {
      title: `Live Sessions - ${classData.name}`,
      classId,
      liveSessions,
      classData: classData,
      currentPage: 'live-sessions',
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('❌ Error in viewLiveSessions:', error);
    res.status(500).render('error/500', {
      title: 'Server Error',
      message: 'Failed to load live sessions'
    });
  }
};

// Join live session
const joinLiveSession = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const sessionId = parseInt(req.params.sessionId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`🎬 Joining live session: ${sessionId}, student: ${studentId}`);

    // Get live session
    const liveSession = await prisma.liveSession.findUnique({
      where: { id: sessionId },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            grade: true,
            section: true
          }
        },
        teacher: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                avatar: true
              }
            }
          }
        }
      }
    });

    if (!liveSession) {
      return res.status(404).render('error/404', { 
        title: 'Live Session Not Found',
        message: 'The requested live session does not exist.'
      });
    }

    // Verify enrollment
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: liveSession.classId,
          studentId: studentId
        }
      }
    });

    if (!enrollment) {
      return res.status(403).render('error/403', { 
        title: 'Access Denied',
        message: 'You are not enrolled in this class'
      });
    }

    // Check if session is live or scheduled
    const now = new Date();
    const startTime = new Date(liveSession.startTime);
    const endTime = liveSession.endTime ? new Date(liveSession.endTime) : null;

    if (now < startTime) {
      return res.status(400).render('error/400', { 
        title: 'Session Not Started',
        message: 'This live session has not started yet.'
      });
    }

    if (endTime && now > endTime) {
      return res.status(400).render('error/400', { 
        title: 'Session Ended',
        message: 'This live session has already ended.'
      });
    }

    // Record participation
    await prisma.liveSessionParticipant.upsert({
      where: {
        liveSessionId_studentId: {
          liveSessionId: sessionId,
          studentId: studentId
        }
      },
      update: {
        joinedAt: new Date(),
        leftAt: null // Reset leftAt if rejoining
      },
      create: {
        liveSessionId: sessionId,
        studentId: studentId,
        joinedAt: new Date()
      }
    });

    // Get student name for the session room
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    console.log('✅ Student joining live session:', student.user.firstName);

    res.render('student/join-live-session', {
      title: `Live: ${liveSession.title}`,
      liveSession: liveSession,
      studentId: studentId,
      studentName: `${student.user.firstName} ${student.user.lastName}`,
      currentPage: 'live-sessions',
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('❌ Error in joinLiveSession:', error);
    res.status(500).render('error/500', {
      error: 'Failed to join live session',
      message: error.message
    });
  }
};

// Leave live session
const leaveLiveSession = async (req, res) => {
  try {
      const studentId = req.session.user.studentId;
    const sessionId = req.params.sessionId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`🚪 Leaving live session: ${sessionId}, student: ${studentId}`);

    // Get participation record
    const participation = await prisma.liveSessionParticipant.findUnique({
      where: {
        liveSessionId_studentId: {
          liveSessionId: sessionId,
          studentId: studentId
        }
      },
      include: {
        liveSession: {
          select: {
            classId: true
          }
        }
      }
    });

    if (participation) {
      const leftAt = new Date();
      const joinedAt = new Date(participation.joinedAt);
      const duration = Math.floor((leftAt - joinedAt) / (1000 * 60)); // Calculate minutes

      await prisma.liveSessionParticipant.update({
        where: {
          id: participation.id
        },
        data: {
          leftAt: leftAt,
          duration: duration
        }
      });

      console.log('✅ Student left live session. Duration:', duration, 'minutes');
    }

    res.json({
      success: true,
      message: 'Successfully left live session',
      redirectUrl: `/student/class/${participation?.liveSession?.classId || ''}/live-sessions`
    });

  } catch (error) {
    console.error('❌ Error in leaveLiveSession:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to leave live session',
      message: error.message
    });
  }
};

// View student progress
const viewProgress = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const userId = req.session.user.id;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log('📊 View progress called for student:', studentId);

        // Get student with enrollments
        const student = await prisma.student.findUnique({
            where: { id: studentId },
            include: {
                user: true,
                enrollments: {
                    include: {
                        class: {
                            include: {
                                teacher: {
                                    include: { user: true }
                                },
                                assignments: {
                                    include: {
                                        submissions: {
                                            where: { studentId: studentId }
                                        }
                                    }
                                },
                                exams: {
                                    include: {
                                        attempts: {
                                            where: { studentId: studentId }
                                        }
                                    }
                                },
                                classWorks: {
                                    include: {
                                        submissions: {
                                            where: { studentId: studentId }
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
            return res.status(404).render('error/404', { title: 'Student Not Found' });
        }

        // Calculate overall progress
        let totalAssignments = 0;
        let completedAssignments = 0;
        let totalExams = 0;
        let completedExams = 0;
        let totalClassWorks = 0;
        let completedClassWorks = 0;
        let averageScore = 0;
        let totalScore = 0;
        let scoreCount = 0;

        student.enrollments.forEach(enrollment => {
            // Assignments
            if (enrollment.class.assignments) {
                totalAssignments += enrollment.class.assignments.length;
                completedAssignments += enrollment.class.assignments.filter(a => 
                    a.submissions && a.submissions.length > 0
                ).length;
                
                // Calculate scores
                enrollment.class.assignments.forEach(assignment => {
                    if (assignment.submissions && assignment.submissions.length > 0 && assignment.submissions[0].grade) {
                        totalScore += assignment.submissions[0].grade;
                        scoreCount++;
                    }
                });
            }

            // Exams
            if (enrollment.class.exams) {
                totalExams += enrollment.class.exams.length;
                completedExams += enrollment.class.exams.filter(e => 
                    e.attempts && e.attempts.length > 0
                ).length;
                
                // Calculate exam scores
                enrollment.class.exams.forEach(exam => {
                    if (exam.attempts && exam.attempts.length > 0 && exam.attempts[0].score) {
                        totalScore += exam.attempts[0].score;
                        scoreCount++;
                    }
                });
            }

            // Class Works
            if (enrollment.class.classWorks) {
                totalClassWorks += enrollment.class.classWorks.length;
                completedClassWorks += enrollment.class.classWorks.filter(cw => 
                    cw.submissions && cw.submissions.length > 0
                ).length;
                
                // Calculate class work scores
                enrollment.class.classWorks.forEach(classWork => {
                    if (classWork.submissions && classWork.submissions.length > 0 && classWork.submissions[0].score) {
                        totalScore += classWork.submissions[0].score;
                        scoreCount++;
                    }
                });
            }
        });

        // Calculate averages
        const assignmentProgress = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0;
        const examProgress = totalExams > 0 ? Math.round((completedExams / totalExams) * 100) : 0;
        const classWorkProgress = totalClassWorks > 0 ? Math.round((completedClassWorks / totalClassWorks) * 100) : 0;
        averageScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
        
        // Overall progress
        const totalTasks = totalAssignments + totalExams + totalClassWorks;
        const completedTasks = completedAssignments + completedExams + completedClassWorks;
        const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        // Get recent activity - FORMAT THE TIME HERE
        const recentSubmissions = await prisma.submission.findMany({
            where: { studentId: studentId },
            include: {
                assignment: {
                    include: {
                        class: true
                    }
                }
            },
            orderBy: { submittedAt: 'desc' },
            take: 10
        });

        // Format submissions with time ago
        const formattedRecentSubmissions = recentSubmissions.map(submission => ({
            ...submission,
            formattedTime: formatTimeAgo(submission.submittedAt)
        }));

        // Get upcoming deadlines
        const upcomingDeadlines = [];
        
        // Upcoming assignments
        const upcomingAssignments = await prisma.assignment.findMany({
            where: {
                class: {
                    enrollments: {
                        some: { studentId: studentId }
                    }
                },
                dueDate: {
                    gt: new Date()
                }
            },
            include: {
                class: true
            },
            orderBy: { dueDate: 'asc' },
            take: 10
        });

        // Upcoming exams
        const upcomingExams = await prisma.exam.findMany({
            where: {
                class: {
                    enrollments: {
                        some: { studentId: studentId }
                    }
                },
                date: {
                    gt: new Date()
                }
            },
            include: {
                class: true
            },
            orderBy: { date: 'asc' },
            take: 10
        });

        // Combine and sort by date
        upcomingDeadlines.push(...upcomingAssignments.map(a => ({
            ...a,
            type: 'assignment',
            date: a.dueDate
        })));
        upcomingDeadlines.push(...upcomingExams.map(e => ({
            ...e,
            type: 'exam',
            date: e.date
        })));
        
        upcomingDeadlines.sort((a, b) => new Date(a.date) - new Date(b.date));

        res.render('student/progress', {
            title: 'My Progress',
            user: student.user,
            enrollments: student.enrollments,
            assignmentProgress,
            examProgress,
            classWorkProgress,
            overallProgress,
            averageScore,
            totalAssignments,
            completedAssignments,
            totalExams,
            completedExams,
            totalClassWorks,
            completedClassWorks,
            recentSubmissions: formattedRecentSubmissions, // Use formatted submissions
            upcomingDeadlines: upcomingDeadlines.slice(0, 10),
            userSchool,
            isSuperAdmin,
            formatTimeAgo: formatTimeAgo // Pass the function for other uses
        });
    } catch (error) {
        console.error('❌ View progress error:', error);
        res.status(500).render('error/500', { 
            title: 'Server Error',
            message: 'Failed to load progress data. Please try again.' 
        });
    }
};

// View detailed analytics
const viewAnalytics = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log('📈 View analytics called for student:', studentId);

        // Get all submissions with scores
        const gradedSubmissions = await prisma.submission.findMany({
            where: {
                studentId: studentId,
                grade: { not: null }
            },
            include: {
                assignment: {
                    include: {
                        class: true
                    }
                }
            },
            orderBy: { submittedAt: 'desc' }
        });

        // Get all exam attempts
        const examAttempts = await prisma.examAttempt.findMany({
            where: {
                studentId: studentId,
                score: { not: null }
            },
            include: {
                exam: {
                    include: {
                        class: true
                    }
                }
            },
            orderBy: { submittedAt: 'desc' }
        });

        // Get all class work submissions
        const classWorkSubmissions = await prisma.classWorkSubmission.findMany({
            where: {
                studentId: studentId,
                score: { not: null }
            },
            include: {
                classWork: {
                    include: {
                        class: true
                    }
                }
            },
            orderBy: { submittedAt: 'desc' }
        });

        // Combine all graded work
        const allGradedWork = [
            ...gradedSubmissions.map(s => ({
                ...s,
                type: 'assignment',
                title: s.assignment.title,
                className: s.assignment.class.name,
                score: s.grade,
                maxScore: s.assignment.points || 100,
                date: s.submittedAt
            })),
            ...examAttempts.map(e => ({
                ...e,
                type: 'exam',
                title: e.exam.title,
                className: e.exam.class.name,
                score: e.score,
                maxScore: e.exam.totalMarks || 100,
                date: e.submittedAt
            })),
            ...classWorkSubmissions.map(c => ({
                ...c,
                type: 'classwork',
                title: c.classWork.title,
                className: c.classWork.class.name,
                score: c.score,
                maxScore: c.classWork.points || 100,
                date: c.submittedAt
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Calculate performance by subject/class
        const performanceByClass = {};
        allGradedWork.forEach(work => {
            if (!performanceByClass[work.className]) {
                performanceByClass[work.className] = {
                    totalScore: 0,
                    maxScore: 0,
                    count: 0,
                    items: []
                };
            }
            performanceByClass[work.className].totalScore += work.score;
            performanceByClass[work.className].maxScore += work.maxScore;
            performanceByClass[work.className].count++;
            performanceByClass[work.className].items.push(work);
        });

        // Calculate percentages
        Object.keys(performanceByClass).forEach(className => {
            const data = performanceByClass[className];
            data.percentage = data.maxScore > 0 ? Math.round((data.totalScore / data.maxScore) * 100) : 0;
            data.averageScore = data.count > 0 ? Math.round(data.totalScore / data.count) : 0;
        });

        // Performance over time (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentGradedWork = allGradedWork.filter(work => 
            new Date(work.date) >= thirtyDaysAgo
        );

        // Group by date for chart
        const performanceByDate = {};
        recentGradedWork.forEach(work => {
            const date = new Date(work.date).toISOString().split('T')[0];
            if (!performanceByDate[date]) {
                performanceByDate[date] = {
                    totalScore: 0,
                    maxScore: 0,
                    count: 0
                };
            }
            performanceByDate[date].totalScore += work.score;
            performanceByDate[date].maxScore += work.maxScore;
            performanceByDate[date].count++;
        });

        // Prepare chart data
        const chartData = Object.keys(performanceByDate)
            .sort()
            .map(date => ({
                date,
                percentage: performanceByDate[date].maxScore > 0 
                    ? Math.round((performanceByDate[date].totalScore / performanceByDate[date].maxScore) * 100)
                    : 0
            }));

        res.render('student/analytics', {
            title: 'Performance Analytics',
            allGradedWork,
            performanceByClass,
            chartData,
            totalGradedItems: allGradedWork.length,
            averageOverall: allGradedWork.length > 0 
                ? Math.round(allGradedWork.reduce((sum, work) => sum + (work.score / work.maxScore * 100), 0) / allGradedWork.length)
                : 0,
            userSchool,
            isSuperAdmin
        });
    } catch (error) {
        console.error('❌ View analytics error:', error);
        res.status(500).render('error/500', { 
            title: 'Server Error',
            message: 'Failed to load analytics. Please try again.' 
        });
    }
};

// Get recent notifications for student
const getRecentNotifications = async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    console.log(`📨 Getting recent notifications for user: ${userId}`);

    // Get only unread notifications
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

    // Format notifications for JSON response
    const formattedNotifications = notifications.map(notif => ({
      id: notif.id,
      title: notif.title,
      message: notif.message,
      icon: notif.icon,
      time: formatTimeAgo(notif.createdAt),
      read: notif.read
    }));

    console.log(`✅ Found ${formattedNotifications.length} recent notifications`);

    res.json({
      success: true,
      notifications: formattedNotifications,
      count: formattedNotifications.length
    });

  } catch (error) {
    console.error('❌ Error getting recent notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load notifications',
      count: 0
    });
  }
};

// Mark notification as read
const markNotificationAsRead = async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.session.user.id;

    await prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId: userId
      },
      data: {
        read: true
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
  }
};

// Mark all notifications as read
const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.session.user.id;

    await prisma.notification.updateMany({
      where: {
        userId: userId,
        read: false
      },
      data: {
        read: true
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark all notifications as read' });
  }
};


// View all live sessions across all classes
const viewAllLiveSessions = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log(`🎥 Fetching all live sessions for student: ${studentId}`);

        // Get student's enrolled classes
        const student = await prisma.student.findUnique({
            where: { id: studentId },
            include: {
                enrollments: {
                    include: {
                        class: true
                    }
                }
            }
        });

        if (!student) {
            return res.status(404).render('error/404', { title: 'Student Not Found' });
        }

        const classIds = student.enrollments.map(e => e.classId);

        // Get all live sessions for the student's classes
        const liveSessions = await prisma.liveSession.findMany({
            where: {
                classId: {
                    in: classIds
                },
                isActive: true
            },
            include: {
                class: {
                    select: {
                        name: true,
                        grade: true,
                        section: true
                    }
                },
                teacher: {
                    include: {
                        user: {
                            select: {
                                firstName: true,
                                lastName: true
                            }
                        }
                    }
                },
                participants: {
                    where: { 
                        studentId: studentId 
                    },
                    select: {
                        id: true,
                        joinedAt: true,
                        leftAt: true,
                        duration: true
                    }
                }
            },
            orderBy: [
                { startTime: 'desc' }
            ]
        });

        // Categorize sessions
        const now = new Date();
        const upcomingSessions = [];
        const ongoingSessions = [];
        const pastSessions = [];

        liveSessions.forEach(session => {
            const startTime = new Date(session.startTime);
            const endTime = session.endTime ? new Date(session.endTime) : null;
            
            if (now < startTime) {
                // Upcoming session
                upcomingSessions.push({
                    ...session,
                    status: 'upcoming',
                    timeUntil: Math.floor((startTime - now) / (1000 * 60)) // minutes until start
                });
            } else if ((!endTime && now >= startTime) || (endTime && now >= startTime && now <= endTime)) {
                // Ongoing session
                ongoingSessions.push({
                    ...session,
                    status: 'ongoing'
                });
            } else {
                // Past session
                pastSessions.push({
                    ...session,
                    status: 'past'
                });
            }
        });

        console.log(`✅ Live sessions loaded: ${liveSessions.length}`);

        res.render('student/all-live-sessions', {
            title: 'Live Sessions',
            upcomingSessions,
            ongoingSessions,
            pastSessions,
            userSchool: userSchool,
            isSuperAdmin: isSuperAdmin
        });

    } catch (error) {
        console.error('❌ Error in viewAllLiveSessions:', error);
        res.status(500).render('error/500', {
            title: 'Server Error',
            message: 'Failed to load live sessions'
        });
    }
};

// Export all functions
module.exports = {
    // Dashboard
    dashboard,
    viewClasses,
    
    // Materials
    viewMaterials,
    
    // Assignments
    getClassAssignments,
    viewAssignments,
    viewAllAssignments,
    getSubmitAssignment,
    submitAssignment,
    getSubmissionPage,
    getEnhancedSubmissionPage,
    submitAssignmentFile,
    submitEnhancedAssignment,
    getEnhancedSubmitAssignment,
    submitTextAssignment,
    submitDrawingAssignment,
    
    // Grades
    viewAllGrades,
    
    // Exams
    viewExams,
    takeExam,
    viewExamResults,
    getExamQuestions,
    submitExam,
    
    // Notes
    getNotes,
    saveNote,
    updateNote,
    deleteNote,

    // Materials
    downloadMaterial,
    
    // Class Works
    viewClassWorks,
    takeClassWork,
    submitClassWork,
    viewClassWorkResults,
    
    // Live Sessions
    viewLiveSessions,
    joinLiveSession,
    leaveLiveSession,
    viewAllLiveSessions ,
    viewProgress,
    viewAnalytics,
    
    // Add this line for notifications:
    getRecentNotifications,
    getRecentNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead
};