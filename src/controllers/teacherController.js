const prisma = require('../config/database');
const notificationService = require('../services/notificationService');
const path = require('path');
const { parseTextContent, parseDocx, extractRawTextFromDocx } = require('../utils/questionParser');

const debugAssignment = async (teacherId, assignmentId, operation) => {
  console.log(`\n🔍 [DEBUG ${operation.toUpperCase()}]`);
  console.log(`Teacher ID: ${teacherId}`);
  console.log(`Assignment ID: ${assignmentId}`);
  console.log(`Operation: ${operation}`);
  console.log(`Time: ${new Date().toISOString()}\n`);
};

// Helper function to format time ago
function formatTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  if (diffInSeconds < 60) return 'Just now';
  else if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minute${Math.floor(diffInSeconds / 60) !== 1 ? 's' : ''} ago`;
  else if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hour${Math.floor(diffInSeconds / 3600) !== 1 ? 's' : ''} ago`;
  else if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} day${Math.floor(diffInSeconds / 86400) !== 1 ? 's' : ''} ago`;
  else return date.toLocaleDateString();
}

// Create notification function
const createNotification = async (userId, title, message, icon = 'fa-info-circle') => {
  try {
    await prisma.notification.create({
      data: { title, message, icon, userId, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
};

// Helper function to get appropriate icon for material type
function getMaterialIcon(type) {
  const iconMap = {
    textbook: 'fa-book',
    video: 'fa-video',
    document: 'fa-file-pdf',
    presentation: 'fa-presentation-screen',
    other: 'fa-file'
  };
  return iconMap[type] || 'fa-file';
}

// ========== CORE TEACHER FUNCTIONS ==========

// Teacher dashboard
exports.dashboard = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get teacher with classes
    const teacher = await prisma.teacher.findUnique({
      where: {
        id: teacherId
      },
      include: {
        user: true,
        classes: {
          include: {
            enrollments: {
              include: {
                student: {
                  include: {
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!teacher) {
      return res.status(404).render('error/404', { title: 'Teacher Not Found' });
    }

    // Calculate total students
    let totalStudents = 0;
    teacher.classes.forEach(cls => {
      totalStudents += cls.enrollments.length;
    });

    // Get pending grading submissions
    const pendingGrading = await prisma.submission.findMany({
      where: {
        grade: null,
        assignment: {
          teacherId: teacherId
        }
      },
      include: {
        assignment: {
          include: {
            class: {
              select: {
                name: true
              }
            }
          }
        },
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
      },
      orderBy: {
        submittedAt: 'desc'
      },
      take: 5
    });

    // Get active class works count
    const activeClassWorks = await prisma.classWork.count({
      where: {
        teacherId: teacherId,
        isActive: true
      }
    });

    // Get live sessions count
    const liveSessionsCount = await prisma.liveSession.count({
      where: {
        teacherId: teacherId,
        isActive: true
      }
    });

    // Get recent class works
    const recentClassWorks = await prisma.classWork.findMany({
      where: {
        teacherId: teacherId
      },
      include: {
        class: {
          select: {
            name: true
          }
        },
        submissions: {
          select: {
            id: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    // Get upcoming live sessions
    const upcomingLiveSessions = await prisma.liveSession.findMany({
      where: {
        teacherId: teacherId,
        startTime: {
          gt: new Date()
        }
      },
      include: {
        class: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        startTime: 'asc'
      },
      take: 5
    });

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

    // Count only unread notifications
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

    // --- Compute avatar data for navbar and profile ---
    const user = req.session.user;
    let avatarUrl = '';
    let fallbackAvatar = '';
    if (user) {
      const firstName = user.firstName || '';
      const lastName = user.lastName || '';
      fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + ' ' + lastName)}&background=6a11cb&color=fff&size=100`;
      if (user.avatar) {
        if (user.avatar.startsWith('http://') || user.avatar.startsWith('https://')) {
          avatarUrl = user.avatar;
        } else {
          avatarUrl = '/' + user.avatar;
        }
      }
    }

    // ✅ ADDED: lessonNotesCount – placeholder until feature is built
    const lessonNotesCount = 0; // TODO: Replace with actual count from database when lesson notes are implemented

    res.render('teacher/dashboard', {
      title: 'Teacher Dashboard',
      user: teacher.user,
      teacher,
      classes: teacher.classes,
      totalStudents,
      pendingGrading,
      activeClassWorks,
      liveSessionsCount,
      recentClassWorks,
      upcomingLiveSessions,
      notifications: formattedNotifications,
      notificationCount,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin,
      avatarUrl: avatarUrl,
      fallbackAvatar: fallbackAvatar,
      lessonNotesCount: lessonNotesCount  // ✅ NOW INCLUDED
    });

  } catch (error) {
    console.error('Teacher dashboard error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get teacher's classes
exports.viewClasses = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // First verify teacher
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: { user: true }
    });

    if (!teacher) {
      return res.status(404).render('error/404', { title: 'Teacher Not Found' });
    }

    // Get classes
    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId
      },
      include: {
        enrollments: {
          include: {
            student: {
              include: {
                user: true
              }
            }
          }
        },
        _count: {
          select: {
            assignments: true,
            materials: true,
            exams: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.render('teacher/classes', {
      title: 'My Classes',
      classes: classes,
      teacher: teacher,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get specific class by ID
exports.getClassDetails = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const classId = req.params.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Use findFirst instead of findUnique for multiple conditions
    const classDetail = await prisma.class.findFirst({
      where: {
        id: classId,  // String ID
        teacherId: teacherId  // String ID
      },
      include: {
        enrollments: {
          include: {
            student: {
              include: {
                user: true
              }
            }
          }
        },
        assignments: {
          include: {
            submissions: true
          }
        },
        materials: true,
        exams: true,
        teacher: {
          include: {
            user: true
          }
        }
      }
    });

    if (!classDetail) {
      req.flash('error', 'Class not found');
      return res.redirect('/teacher/classes');
    }

    res.render('teacher/class-detail', {
      title: `Class: ${classDetail.name}`,
      classDetail: classDetail,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('Get class by ID error:', error);
    res.status(500).render('error/500', {
      title: 'Server Error',
      message: 'Failed to load class details: ' + error.message
    });
  }
};

// Get class students - ADD THIS MISSING FUNCTION
exports.getClassStudents = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const classId = req.params.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get class with students
    const classDetail = await prisma.class.findUnique({
      where: {
        id: classId,
        teacherId: teacherId
      },
      include: {
        enrollments: {
          include: {
            student: {
              include: {
                user: true
              }
            }
          }
        },
        teacher: {
          include: {
            user: true
          }
        }
      }
    });

    if (!classDetail) {
      req.flash('error', 'Class not found');
      return res.redirect('/teacher/classes');
    }

    res.render('teacher/class-students', {
      title: `Students in ${classDetail.name}`,
      classDetail: classDetail,
      students: classDetail.enrollments.map(enrollment => enrollment.student),
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('Get class students error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// ========== ASSIGNMENT MANAGEMENT ==========

// Get assignments
exports.viewAssignments = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    const user = req.session.user;

    // 1. Fetch assignments with related data
    const assignments = await prisma.assignment.findMany({
      where: { teacherId: teacherId },
      include: {
        class: true,
        submissions: {
          include: {
            student: {
              include: { user: true }
            }
          }
        }
      },
      orderBy: { dueDate: 'asc' }
    });

    // 2. Enhance submissions: ensure score is derived from grade if score is null
    const enhancedAssignments = assignments.map(assignment => ({
      ...assignment,
      submissions: assignment.submissions.map(submission => ({
        ...submission,
        score: submission.score !== null ? submission.score : submission.grade
      }))
    }));

    // 3. Pre-calculate statistics and categories
    const now = new Date();
    let totalSubmissions = 0;
    let pendingGrading = 0;
    const active = [];
    const upcoming = [];
    const completed = [];

    for (const a of enhancedAssignments) {
      if (a.submissions) {
        totalSubmissions += a.submissions.length;
        pendingGrading += a.submissions.filter(s => s.grade === null).length;
      }
      const due = new Date(a.dueDate);
      if (due >= now && a.isActive !== false) {
        active.push(a);
      } else if (due > now && !a.isActive) {
        upcoming.push(a);
      } else {
        completed.push(a);
      }
    }

    // 4. Fetch classes (optional – for sidebar or filters if needed)
    const classes = await prisma.class.findMany({
      where: { teacherId: teacherId }
    });

    // 5. Render the clean new view
    res.render('teacher/assignments-new', {
      title: 'Assignments',
      // Full list (if needed, but you can also use the individual arrays)
      assignments: enhancedAssignments,
      activeAssignments: active,
      upcomingAssignments: upcoming,
      completedAssignments: completed,
      totalAssignments: enhancedAssignments.length,
      totalSubmissions: totalSubmissions,
      pendingGrading: pendingGrading,
      classes: classes,         // optional
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin,
      user: user
    });

  } catch (error) {
    console.error('❌ Get assignments error:', error);
    res.status(500).render('error/500', {
      title: 'Server Error',
      message: 'Failed to load assignments: ' + error.message
    });
  }
};

// Create assignment (FIXED)
exports.createAssignment = async (req, res) => {
  try {
    const teacherId = req.session.user?.teacherId;
    const { title, description, classId, dueDate, points } = req.body;

    console.log('📝 Creating assignment:', { 
      title, description, classId, dueDate, teacherId 
    });

    // Validate required fields
    if (!title || !title.trim()) {
      req.flash('error', 'Assignment title is required');
      return res.redirect('/teacher/assignments');
    }

    if (!classId) {
      req.flash('error', 'Please select a class');
      return res.redirect('/teacher/assignments');
    }

    if (!dueDate) {
      req.flash('error', 'Due date is required');
      return res.redirect('/teacher/assignments');
    }

    // Create data with proper relation fields
    const createData = {
      title: title.trim(),
      description: description ? description.trim() : null,
      dueDate: new Date(dueDate),
      points: points ? parseInt(points) : 100,
      createdAt: new Date(),
      // FIX: Use relation fields instead of scalar fields
      class: {
        connect: { id: classId }
      },
      teacher: {
        connect: { id: teacherId }
      }
    };

    console.log('Create data:', createData);

    const assignment = await prisma.assignment.create({
      data: createData
    });

    console.log('✅ Assignment created:', assignment.id);
    
    // ADD NOTIFICATION SERVICE CALL HERE
    try {
      await notificationService.notifyAssignmentCreated(assignment.id, teacherId, classId);
      console.log('📢 Assignment creation notification sent');
    } catch (notificationError) {
      console.error('❌ Failed to send assignment notification:', notificationError);
      // Don't fail the whole operation if notification fails
    }
    
    req.flash('success', 'Assignment created successfully');
    res.redirect('/teacher/assignments');

  } catch (error) {
    console.error('❌ Create assignment error:', error);
    req.flash('error', 'Failed to create assignment: ' + error.message);
    res.redirect('/teacher/assignments');
  }
};

// Update assignment (FIXED VERSION)
exports.updateAssignment = async (req, res) => {
  try {
    const teacherId = req.session.user?.teacherId;
    const assignmentId = req.params.id;
    const { title, description, dueDate, classId, points } = req.body;

    console.log(`\n🔄 UPDATE Assignment Request START:`);
    console.log(`Teacher ID: ${teacherId}`);
    console.log(`Assignment ID: ${assignmentId}`);
    console.log(`Request body:`, req.body);

    // Validate inputs
    if (!teacherId) {
      console.error('❌ No teacherId in session');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: No teacher session'
      });
    }

    if (!assignmentId) {
      console.error('❌ No assignmentId provided');
      return res.status(400).json({
        success: false,
        message: 'Assignment ID is required'
      });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Assignment title is required'
      });
    }

    // First, check if the assignment exists
    const existingAssignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId
      }
    });

    console.log(`🔍 Existing assignment:`, existingAssignment);

    if (!existingAssignment) {
      console.error(`❌ Assignment ${assignmentId} not found`);
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Verify assignment belongs to teacher
    if (existingAssignment.teacherId !== teacherId) {
      console.error(`❌ Assignment ${assignmentId} doesn't belong to teacher ${teacherId}`);
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this assignment'
      });
    }

    // Verify the new class belongs to teacher (if changing class)
    if (classId && classId !== existingAssignment.classId) {
      const newClass = await prisma.class.findFirst({
        where: {
          id: classId,
          teacherId: teacherId
        }
      });

      if (!newClass) {
        console.error(`❌ Class ${classId} not found or doesn't belong to teacher`);
        return res.status(400).json({
          success: false,
          message: 'Invalid class selected or class does not belong to you'
        });
      }
    }

    // Prepare the update data - SIMPLE VERSION
    const updateData = {
      title: title.trim(),
      description: description ? description.trim() : null,
      dueDate: dueDate ? new Date(dueDate) : existingAssignment.dueDate,
      points: points ? parseInt(points) : existingAssignment.points || 100,
      updatedAt: new Date()
    };

    // IMPORTANT: Try updating classId directly first
    if (classId && classId !== existingAssignment.classId) {
      console.log(`🔄 Updating classId from ${existingAssignment.classId} to ${classId}`);
      updateData.classId = classId;
    }

    console.log('📝 Update data:', JSON.stringify(updateData, null, 2));

    // Try updating with direct scalar fields first
    try {
      console.log('💾 Attempting Prisma update...');
      
      const updatedAssignment = await prisma.assignment.update({
        where: {
          id: assignmentId
        },
        data: updateData,
        include: {
          class: true
        }
      });

      console.log(`✅ Assignment updated successfully! ID: ${updatedAssignment.id}`);

      res.json({
        success: true,
        message: 'Assignment updated successfully',
        assignment: {
          id: updatedAssignment.id,
          title: updatedAssignment.title,
          dueDate: updatedAssignment.dueDate,
          class: updatedAssignment.class
        }
      });

    } catch (prismaError) {
      console.error('❌ Prisma update error:', prismaError);
      console.error('Error code:', prismaError.code);
      console.error('Error meta:', prismaError.meta);

      // If Prisma update fails, try raw SQL
      try {
        console.log('🔄 Attempting raw SQL update...');
        
        // Build the SET clause
        const setClauses = [];
        const values = [];
        
        // Add each field to update
        if (title) {
          setClauses.push(`title = $${setClauses.length + 1}`);
          values.push(title.trim());
        }
        
        if (description !== undefined) {
          setClauses.push(`description = $${setClauses.length + 1}`);
          values.push(description ? description.trim() : null);
        }
        
        if (dueDate) {
          setClauses.push(`"dueDate" = $${setClauses.length + 1}`);
          values.push(new Date(dueDate));
        }
        
        if (classId && classId !== existingAssignment.classId) {
          setClauses.push(`"classId" = $${setClauses.length + 1}`);
          values.push(classId);
        }
        
        if (points) {
          setClauses.push(`points = $${setClauses.length + 1}`);
          values.push(parseInt(points));
        }
        
        setClauses.push(`"updatedAt" = $${setClauses.length + 1}`);
        values.push(new Date());
        
        // Add WHERE conditions
        values.push(assignmentId);
        values.push(teacherId);
        
        const query = `
          UPDATE "Assignment" 
          SET ${setClauses.join(', ')}
          WHERE id = $${setClauses.length + 1} 
            AND "teacherId" = $${setClauses.length + 2}
          RETURNING *
        `;
        
        console.log('SQL Query:', query);
        console.log('SQL Values:', values);
        
        const result = await prisma.$queryRawUnsafe(query, ...values);
        console.log('✅ Raw SQL update successful:', result[0]);
        
        // Get the updated assignment with class info
        const updatedAssignment = await prisma.assignment.findUnique({
          where: { id: assignmentId },
          include: { class: true }
        });
        
        res.json({
          success: true,
          message: 'Assignment updated successfully (via SQL)',
          assignment: updatedAssignment
        });
        
      } catch (sqlError) {
        console.error('❌ Raw SQL update also failed:', sqlError);
        
        res.status(500).json({
          success: false,
          message: 'Failed to update assignment in database',
          error: process.env.NODE_ENV === 'development' ? {
            prismaError: prismaError.message,
            sqlError: sqlError.message
          } : undefined
        });
      }
    }

  } catch (error) {
    console.error('❌ Unexpected error in updateAssignment:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete assignment (FIXED)
exports.deleteAssignment = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const assignmentId = req.params.id; // String ID

    console.log('🗑️ Deleting assignment:', { assignmentId, teacherId });

    if (!assignmentId) {
      return res.status(400).json({
        success: false,
        message: 'Assignment ID is required'
      });
    }

    // Check if assignment exists and belongs to teacher
    const existingAssignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        teacherId: teacherId
      }
    });

    if (!existingAssignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found or unauthorized'
      });
    }

    // Delete associated submissions first (if any)
    await prisma.submission.deleteMany({
      where: {
        assignmentId: assignmentId
      }
    });

    // Delete the assignment
    await prisma.assignment.delete({
      where: {
        id: assignmentId
      }
    });

    console.log('✅ Assignment deleted:', assignmentId);

    res.json({
      success: true,
      message: 'Assignment deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete assignment: ' + error.message
    });
  }
};

// Get assignment by ID (FIXED)
exports.getAssignment = async (req, res) => {
  try {
    const teacherId = req.session.user?.teacherId;
    const assignmentId = req.params.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`\n🔍 GET Assignment Request (FIXED VERSION):`);
    console.log(`Teacher ID: ${teacherId}`);
    console.log(`Assignment ID: ${assignmentId}`);
    console.log(`Session User:`, req.session.user);

    // Validate inputs
    if (!teacherId) {
      console.error('❌ No teacherId in session');
      return res.status(401).render('error/401', {
        title: 'Unauthorized',
        message: 'You must be logged in as a teacher'
      });
    }

    if (!assignmentId) {
      console.error('❌ No assignment ID provided');
      return res.status(400).render('error/400', {
        title: 'Bad Request',
        message: 'Assignment ID is required'
      });
    }

    // FIXED: Use findFirst() instead of findUnique() for multiple conditions
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        teacherId: teacherId
      },
      include: {
        class: true,
        submissions: {
          include: {
            student: {
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
          }
        },
        teacher: {
          include: {
            user: true
          }
        }
      }
    });


    console.log(`✅ Assignment found:`, assignment ? 'Yes' : 'No');

    if (!assignment) {
      console.log(`❌ Assignment ${assignmentId} not found for teacher ${teacherId}`);
      return res.status(404).render('error/404', {
        title: 'Assignment Not Found',
        message: 'The requested assignment does not exist or you do not have permission to view it.'
      });
    }

    // Get teacher's classes for the dropdown
    const classes = await prisma.class.findMany({
      where: { teacherId: teacherId }
    });

    console.log(`✅ Found ${classes.length} classes for teacher`);

    res.render('teacher/assignment-view', {
      title: `Assignment: ${assignment.title}`,
      assignment: assignment,
      classes: classes,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('❌ Get assignment by ID error:', error);
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    res.status(500).render('error/500', {
      title: 'Server Error',
      message: 'Failed to load assignment details.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


// Create assignment form
exports.createAssignmentForm = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId
      }
    });

    res.render('teacher/create-assignment', {
      title: 'Create Assignment',
      classes: classes,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Create assignment form error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Delete assignment route handler
exports.deleteAssignment = async (req, res) => {
  try {
    const teacherId = req.session.user?.teacherId;
    const assignmentId = req.params.id;

    console.log(`\n🗑️ DELETE Assignment Request:`);
    console.log(`Teacher ID: ${teacherId}`);
    console.log(`Assignment ID: ${assignmentId}`);

    if (!teacherId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: No teacher session'
      });
    }

    if (!assignmentId) {
      return res.status(400).json({
        success: false,
        message: 'Assignment ID is required'
      });
    }

    // Check if assignment exists and belongs to teacher
    const existingAssignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        teacherId: teacherId
      }
    });

    if (!existingAssignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found or unauthorized'
      });
    }

    // Delete associated submissions first
    const deleteSubmissions = await prisma.submission.deleteMany({
      where: {
        assignmentId: assignmentId
      }
    });
    console.log(`✅ Deleted ${deleteSubmissions.count} submissions`);

    // Delete the assignment
    const deletedAssignment = await prisma.assignment.delete({
      where: {
        id: assignmentId
      }
    });

    console.log(`✅ Assignment deleted successfully:`, assignmentId);

    res.json({
      success: true,
      message: 'Assignment deleted successfully',
      deletedAssignmentId: assignmentId
    });

  } catch (error) {
    console.error('❌ Error deleting assignment:', error);
    console.error('Error details:', error.message, error.code);

    res.status(500).json({
      success: false,
      message: 'Failed to delete assignment',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
};

// ========== ASSIGNMENT DESCRIPTION PARSING (FIXED) ==========
/**
 * POST /teacher/assignments/parse-description
 * Parses uploaded .txt or .docx file and returns plain text to populate description
 */
exports.parseAssignmentDescription = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let text = '';

    if (fileExt === '.txt') {
      text = req.file.buffer.toString('utf8');
    } else if (fileExt === '.docx') {
      // ✅ MUST use extractRawTextFromDocx – returns plain text, NOT questions
      text = await extractRawTextFromDocx(req.file.buffer);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported file type. Please upload .txt or .docx files.'
      });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No text could be extracted from the file.'
      });
    }

    console.log(`✅ Parsed description (${text.length} chars) from ${req.file.originalname}`);
    res.json({ success: true, text: text.trim() });

  } catch (error) {
    console.error('❌ Assignment description parsing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to parse file: ' + error.message
    });
  }
};

// ========== GRADING MANAGEMENT ==========

// Get grading
exports.viewGrading = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const submissions = await prisma.submission.findMany({
      where: {
        assignment: {
          teacherId: teacherId
        }
      },
      include: {
        assignment: {
          include: {
            class: true
          }
        },
        student: {
          include: {
            user: true
          }
        }
      },
      orderBy: {
        submittedAt: 'desc'
      }
    });

    // ADD THIS: Ensure score field is populated from grade field
    const enhancedSubmissions = submissions.map(submission => ({
      ...submission,
      // Use grade for score if score is null but grade exists
      score: submission.score !== null ? submission.score : submission.grade
    }));

    // Calculate counts based on GRADE field
    let pendingCount = 0;
    let gradedCount = 0;
    
    enhancedSubmissions.forEach(submission => {
      if (submission.grade === null || submission.grade === undefined) {
        pendingCount++;
      } else {
        gradedCount++;
      }
    });

    res.render('teacher/grading', {
      title: 'Grading',
      submissions: enhancedSubmissions,  // Use enhanced submissions
      pendingCount: pendingCount,
      gradedCount: gradedCount,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Get grading error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// ========== GRADING MANAGEMENT ==========

// Grade submission – handles both AJAX and traditional forms
exports.submitGrade = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submissionId = req.params.submissionId;
    const { score, feedback } = req.body;

    console.log('🎯 Submitting grade for:', submissionId);

    // Validate - must be integer for grade field
    if (score === undefined || score === null || score === '') {
      if (req.accepts('json')) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a score'
        });
      } else {
        req.flash('error', 'Please enter a score');
        return res.redirect('/teacher/grading');
      }
    }

    const gradeInt = parseInt(score, 10);
    if (isNaN(gradeInt)) {
      if (req.accepts('json')) {
        return res.status(400).json({
          success: false,
          message: 'Score must be a number'
        });
      } else {
        req.flash('error', 'Score must be a number');
        return res.redirect('/teacher/grading');
      }
    }

    // Get assignment to validate max points
    const submission = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        assignment: { teacherId: teacherId }
      },
      include: { assignment: true }
    });

    if (!submission) {
      if (req.accepts('json')) {
        return res.status(404).json({
          success: false,
          message: 'Submission not found'
        });
      } else {
        req.flash('error', 'Submission not found');
        return res.redirect('/teacher/grading');
      }
    }

    const maxPoints = submission.assignment.points || 100;
    if (gradeInt < 0 || gradeInt > maxPoints) {
      const msg = `Score must be between 0 and ${maxPoints}`;
      if (req.accepts('json')) {
        return res.status(400).json({ success: false, message: msg });
      } else {
        req.flash('error', msg);
        return res.redirect('/teacher/grading');
      }
    }

    // Update using ONLY fields from your schema
    await prisma.submission.update({
      where: { id: submissionId },
      data: {
        grade: gradeInt,      // This is Int? in your schema
        feedback: feedback || null  // This is String? in your schema
        // No gradedAt field in your schema!
      }
    });

    console.log(`✅ Grade ${gradeInt} saved to grade field`);

    // Send notification
    try {
      await notificationService.notifyAssignmentGraded(submissionId, gradeInt, feedback || '');
      console.log('📢 Grade submission notification sent');
    } catch (notificationError) {
      console.error('❌ Failed to send grade notification:', notificationError);
      // Don't fail the whole operation if notification fails
    }

    // ✅ Check if request accepts JSON
    if (req.accepts('json')) {
      return res.json({
        success: true,
        message: 'Grade submitted successfully'
      });
    } else {
      req.flash('success', 'Grade submitted successfully!');
      return res.redirect('/teacher/grading');
    }

  } catch (error) {
    console.error('❌ Grading error:', error);
    if (req.accepts('json')) {
      return res.status(500).json({
        success: false,
        message: 'Failed to submit grade: ' + error.message
      });
    } else {
      req.flash('error', 'Failed to submit grade: ' + error.message);
      return res.redirect('/teacher/grading');
    }
  }
};

// ========== EXAM MANAGEMENT ==========

// Get exams
exports.viewExams = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const exams = await prisma.exam.findMany({
      where: {
        teacherId: teacherId
      },
      include: {
        class: true,
        attempts: {
          include: {
            student: {
              include: {
                user: true
              }
            }
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });

    const upcomingExams = exams.filter(exam => new Date(exam.date) > new Date() && exam.isActive);
    const recentExams = exams.filter(exam => new Date(exam.date) <= new Date()).slice(0, 5);

    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId
      }
    });

    // Pass success/error messages to template
    const success = req.session.success;
    const error = req.session.error;
    delete req.session.success;
    delete req.session.error;

    res.render('teacher/exams', {
      title: 'Exams',
      exams,
      upcomingExams,
      recentExams,
      classes,
      success,
      error,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Get exams error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Create exam form
exports.createExamForm = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId
      }
    });

    res.render('teacher/create-exam', {
      title: 'Create Exam',
      classes: classes,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Create exam form error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Create exam - USER FRIENDLY VERSION
exports.createExam = async (req, res) => {
  try {
    console.log('🔔 Create exam request received');
    console.log('Request body:', req.body);

    const teacherId = req.session.user.teacherId;
    const {
      title,
      description,
      duration,
      date,
      classId,
      questions,
      maxAttempts,
      showResults,
      totalMarks
    } = req.body;

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Exam title is required.'
      });
    }

    if (!duration || isNaN(duration) || duration < 1) {
      return res.status(400).json({
        success: false,
        message: 'Valid duration is required (minimum 1 minute).'
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Exam date and time is required.'
      });
    }

    if (!classId) {
      return res.status(400).json({
        success: false,
        message: 'Please select a class.'
      });
    }

    // Parse questions - handle empty or undefined questions
    let parsedQuestions = [];
    
    try {
      if (questions && typeof questions === 'string' && questions.trim() !== '') {
        parsedQuestions = JSON.parse(questions);
      } else if (Array.isArray(questions)) {
        parsedQuestions = questions;
      }
      
      console.log(`✅ Parsed ${parsedQuestions.length} questions`);
      
      // Validate each question if there are any
      if (parsedQuestions.length > 0) {
        parsedQuestions.forEach((q, index) => {
          if (!q.question || !q.question.trim()) {
            throw new Error(`Question ${index + 1} is missing text`);
          }
          
          if (!q.type) {
            throw new Error(`Question ${index + 1} is missing type`);
          }
          
          // Set default points if not provided
          if (!q.points || isNaN(q.points) || q.points < 1) {
            q.points = 1;
          }
          
          // Validate multiple choice questions
          if (q.type === 'multiple_choice') {
            if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
              throw new Error(`Question ${index + 1} (multiple choice) needs at least 2 options`);
            }
            
            // Check if at least one option is marked as correct
            const hasCorrect = q.options.some(opt => opt.isCorrect === true);
            if (!hasCorrect) {
              throw new Error(`Question ${index + 1} needs a correct answer selected`);
            }
          }
        });
      } else {
        console.log('⚠️ No questions provided - creating exam without questions');
        // Allow exams without questions - teacher can add them later
      }
    } catch (parseError) {
      console.log('❌ Error parsing questions:', parseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid questions format: ' + parseError.message
      });
    }

    // Calculate total marks if not provided
    let calculatedTotalMarks = 0;
    if (parsedQuestions.length > 0) {
      calculatedTotalMarks = parsedQuestions.reduce((total, q) => 
        total + (parseInt(q.points) || 1), 0);
    }

    // Use provided total marks or calculated
    const finalTotalMarks = totalMarks ? parseInt(totalMarks) : calculatedTotalMarks;

    console.log('📝 Creating exam in database...');
    
    // Create exam in database - USE STRING IDs
    const exam = await prisma.exam.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        duration: parseInt(duration),
        date: new Date(date),
        classId: classId, // Already string
        teacherId: teacherId, // Already string
        questions: parsedQuestions,
        maxAttempts: maxAttempts ? parseInt(maxAttempts) : 1,
        showResults: showResults === 'true' || showResults === true,
        totalMarks: finalTotalMarks,
        isActive: true,
        createdAt: new Date()
      }
    });

    console.log('✅ Exam created successfully with ID:', exam.id);

    // Create notifications for students
    const classStudents = await prisma.enrollment.findMany({
      where: { classId: classId },
      include: { student: true }
    });

    for (const enrollment of classStudents) {
      await createNotification(
        enrollment.student.userId,
        'New Exam Scheduled',
        `Exam "${title}" is scheduled for ${new Date(date).toLocaleDateString()}. Duration: ${duration} minutes`,
        'fa-clipboard-list'
      );
    }
    
    // ADD NOTIFICATION SERVICE CALL HERE
    try {
      await notificationService.notifyExamCreated(exam.id, teacherId, classId);
      console.log('📢 Exam creation notification sent');
    } catch (notificationError) {
      console.error('❌ Failed to send exam notification:', notificationError);
      // Don't fail the whole operation if notification fails
    }

    res.json({
      success: true,
      message: 'Exam created successfully!',
      examId: exam.id
    });

  } catch (error) {
    console.error('❌ Create exam error:', error);
    console.error('Error details:', error.message, error.code);
    
    // Handle specific Prisma errors
    let errorMessage = 'Failed to create exam';
    let statusCode = 500;
    
    if (error.code === 'P2003') {
      errorMessage = 'Invalid class ID. Please select a valid class.';
      statusCode = 400;
    } else if (error.code === 'P2002') {
      errorMessage = 'An exam with similar details already exists.';
      statusCode = 400;
    } else if (error.message.includes('questions')) {
      errorMessage = 'Error with questions: ' + error.message;
      statusCode = 400;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ===== NEW: Parse uploaded exam questions file =====
/**
 * POST /teacher/exams/parse-questions
 * Parses uploaded .txt or .docx file and returns questions as JSON
 */
exports.parseExamQuestions = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let questions = [];

    if (fileExt === '.txt') {
      const text = req.file.buffer.toString('utf8');
      questions = parseTextContent(text);
    } else if (fileExt === '.docx') {
      questions = await parseDocx(req.file.buffer);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported file type. Please upload .txt or .docx files.'
      });
    }

    if (!questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid questions could be extracted from the file.'
      });
    }

    // Optional limit to prevent abuse
    if (questions.length > 100) questions = questions.slice(0, 100);

    console.log(`✅ Parsed ${questions.length} questions from ${req.file.originalname}`);
    res.json({ success: true, questions });

  } catch (error) {
    console.error('❌ Question parsing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to parse questions: ' + error.message
    });
  }
};

// Get exam by ID
exports.viewExam = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const examId = req.params.id; // String ID from route parameter
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`🔍 Viewing exam: ${examId} for teacher: ${teacherId}`);

    // Use findFirst with both conditions
    const exam = await prisma.exam.findFirst({
      where: {
        id: examId, // String ID
        teacherId: teacherId // String ID
      },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            grade: true,
            section: true
          }
        },
        attempts: {
          include: {
            student: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    idNumber: true,
                    avatar: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!exam) {
      console.log(`❌ Exam ${examId} not found for teacher ${teacherId}`);
      return res.status(404).render('error/404', { 
        title: 'Exam Not Found',
        message: 'The requested exam does not exist or you do not have permission to view it.'
      });
    }

    console.log(`✅ Exam found: ${exam.title}`);

    res.render('teacher/exam-detail', {
      title: `Exam: ${exam.title}`,
      exam: exam,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('❌ Get exam by ID error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      message: 'Failed to load exam details: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// View exam results

exports.viewExamResults = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const examId = req.params.id; // String ID (already string from route)
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`🔍 Viewing exam results for exam: ${examId}, teacher: ${teacherId}`);

    // Get exam with attempts and student info
    const exam = await prisma.exam.findFirst({
      where: {
        id: examId, // String ID
        teacherId: teacherId // String ID
      },
      include: {
        class: true,
        attempts: {
          include: {
            student: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    idNumber: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!exam) {
      console.log(`❌ Exam ${examId} not found for teacher ${teacherId}`);
      return res.status(404).render('error/404', { 
        title: 'Exam Not Found',
        message: 'The requested exam does not exist or you do not have permission to view it.'
      });
    }

    console.log(`✅ Exam found: ${exam.title}`);

    // Get class students who should take the exam
    const classStudents = await prisma.enrollment.findMany({
      where: {
        classId: exam.classId
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                idNumber: true
              }
            }
          }
        }
      }
    });

    // Create exam results array with all students
    const examResults = classStudents.map(function(enrollment) {
      const attempt = exam.attempts.find(function(a) {
        return a.studentId === enrollment.studentId;
      });
      return {
        student: enrollment.student,
        exam: exam,
        totalMarks: exam.totalMarks,
        score: attempt ? attempt.score : null,
        submitted: attempt ? true : false,
        submittedAt: attempt ? attempt.submittedAt : null
      };
    });

    res.render('teacher/exam-results', {
      title: `Exam Results: ${exam.title}`,
      exam: exam,
      examResults: examResults,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('❌ View exam results error:', error);
    console.error('Error details:', error.message);
    
    res.status(500).render('error/500', {
      title: 'Server Error',
      message: 'Failed to load exam results: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// ========== MATERIAL MANAGEMENT ==========

// Get materials
exports.viewMaterials = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    const { class: classFilter, type: typeFilter, category: categoryFilter, search } = req.query;

    console.log(`🔍 Loading materials for teacher: ${teacherId}`);

    // Build filter conditions
    const whereCondition = {
      teacherId: teacherId
    };

    // Apply filters if provided
    if (classFilter && classFilter !== 'all') {
      whereCondition.classId = classFilter;
    }

    if (typeFilter && typeFilter !== 'all') {
      whereCondition.type = typeFilter;
    }

    if (categoryFilter && categoryFilter !== 'all') {
      whereCondition.category = categoryFilter;
    }

    if (search) {
      whereCondition.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } }
      ];
    }

    // Get materials with filters
    const materials = await prisma.material.findMany({
      where: whereCondition,
      include: {
        class: {
          select: {
            id: true,
            name: true,
            grade: true,
            section: true
          }
        },
        _count: {
          select: {
            views: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Get all classes for filter dropdown
    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId
      },
      select: {
        id: true,
        name: true,
        grade: true,
        section: true
      },
      orderBy: [
        { grade: 'asc' },
        { name: 'asc' }
      ]
    });

    // Get unique types and categories for filters
    const allMaterials = await prisma.material.findMany({
      where: { teacherId: teacherId },
      select: { type: true, category: true }
    });

    const uniqueTypes = [...new Set(allMaterials.map(m => m.type).filter(Boolean))];
    const uniqueCategories = [...new Set(allMaterials.map(m => m.category).filter(Boolean))];

    // Calculate pending submissions count
    const pendingCount = await prisma.submission.count({
      where: {
        grade: null,
        assignment: {
          teacherId: teacherId
        }
      }
    });

    const pendingClassWorksCount = await prisma.classWorkSubmission.count({
      where: {
        score: null,
        classWork: {
          teacherId: teacherId
        }
      }
    });

    const totalPending = pendingCount + pendingClassWorksCount;

    console.log(`✅ Loaded ${materials.length} materials for teacher`);

    // Helper function for material icons
    const getMaterialIcon = (type) => {
      const iconMap = {
        textbook: 'fa-book',
        video: 'fa-video',
        document: 'fa-file-pdf',
        presentation: 'fa-presentation-screen',
        other: 'fa-file'
      };
      return iconMap[type] || 'fa-file';
    };

    res.render('teacher/materials', {
      title: 'Teaching Materials',
      materials: materials,
      classes: classes,
      uniqueTypes: uniqueTypes,
      uniqueCategories: uniqueCategories,
      pendingSubmissionsCount: totalPending,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin,
      currentFilters: {
        class: classFilter,
        type: typeFilter,
        category: categoryFilter,
        search: search
      },
      getMaterialIcon: getMaterialIcon  // Pass the function to the view
    });
  } catch (error) {
    console.error('❌ Get materials error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      message: 'Failed to load materials: ' + error.message 
    });
  }
};

// Upload material form
exports.uploadMaterialForm = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId
      }
    });

    res.render('teacher/upload-material', {
      title: 'Upload Material',
      classes: classes,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Upload material form error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Upload material
exports.uploadMaterial = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const { title, description, type, category, classId, isPublic, tags } = req.body;
    
    console.log('📤 Uploading material...');
    console.log('Request body:', req.body);
    console.log('Uploaded file:', req.file);
    console.log('Session user:', req.session.user);
    console.log('Teacher ID:', teacherId);

    // Validate required fields
    if (!title || !title.trim()) {
      req.flash('error', 'Title is required');
      return res.redirect('/teacher/materials/upload');
    }

    if (!req.file) {
      req.flash('error', 'Please select a file to upload');
      return res.redirect('/teacher/materials/upload');
    }

    // Validate teacher exists
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId }
    });

    if (!teacher) {
      console.error('❌ Teacher not found:', teacherId);
      req.flash('error', 'Teacher not found');
      return res.redirect('/teacher/materials');
    }

    // Check if file exists
    const fs = require('fs');
    const filePath = req.file.path;
    
    if (!fs.existsSync(filePath)) {
      console.error('❌ File not found at path:', filePath);
      req.flash('error', 'File upload failed - file not found');
      return res.redirect('/teacher/materials/upload');
    }

    console.log('✅ File exists at:', filePath);
    console.log('✅ File size:', req.file.size, 'bytes');

    // Construct file URL - use relative path from public folder
    const fileUrl = `/uploads/materials/${req.file.filename}`; 
    console.log('📝 File URL to store:', fileUrl);

    // Parse classId
    let parsedClassId = null;
    if (classId && classId !== '' && classId !== 'null' && classId !== 'all') {
      parsedClassId = classId;
      
      // Verify class belongs to teacher
      const classExists = await prisma.class.findFirst({
        where: {
          id: classId,
          teacherId: teacherId
        }
      });
      
      if (!classExists) {
        console.error('❌ Class not found or not owned by teacher');
        req.flash('error', 'Invalid class selected');
        return res.redirect('/teacher/materials/upload');
      }
    }

    // Parse isPublic
    const isMaterialPublic = isPublic === 'on' || isPublic === true || isPublic === 'true';
    
    // Parse tags
    let parsedTags = [];
    if (tags) {
      parsedTags = tags.split(',').map(tag => tag.trim()).filter(tag => tag);
    }

    // Prepare material data
    const materialData = {
      title: title.trim(),
      description: description ? description.trim() : null,
      type: type || 'document',
      fileUrl: fileUrl,
      category: category || 'General',
      tags: parsedTags,
      isPublic: isMaterialPublic,
      createdAt: new Date(),
      // Use relation connections instead of direct IDs
      teacher: {
        connect: { id: teacherId }
      }
    };

    // Add class connection if classId exists
    if (parsedClassId) {
      materialData.class = {
        connect: { id: parsedClassId }
      };
    }

    console.log('📝 Creating material with data:', JSON.stringify(materialData, null, 2));

    // Create material in database
    const material = await prisma.material.create({
      data: materialData
    });

    console.log('✅ Material created successfully with ID:', material.id);

    // Create notification
    await createNotification(
      req.session.user.id,
      'Material Uploaded',
      `Material "${title}" has been uploaded successfully`,
      getMaterialIcon(type || 'document')
    );
    
    // ADD NOTIFICATION SERVICE CALL HERE
    try {
      await notificationService.notifyMaterialUploaded(material.id, teacherId, parsedClassId);
      console.log('📢 Material upload notification sent');
    } catch (notificationError) {
      console.error('❌ Failed to send material notification:', notificationError);
      // Don't fail the whole operation if notification fails
    }

    req.flash('success', 'Material uploaded successfully!');
    res.redirect('/teacher/materials');

  } catch (error) {
    console.error('❌ Upload material error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack
    });

    // Handle specific Prisma errors
    let errorMessage = 'Failed to upload material';
    
    if (error.code === 'P2003') {
      errorMessage = 'Invalid teacher or class ID';
    } else if (error.code === 'P2002') {
      errorMessage = 'A material with similar details already exists';
    } else if (error.message.includes('file')) {
      errorMessage = 'File upload error: ' + error.message;
    }

    req.flash('error', errorMessage);
    res.redirect('/teacher/materials/upload');
  }
};

// Download material
exports.downloadMaterial = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const materialId = parseInt(req.params.materialId);

    const material = await prisma.material.findFirst({
      where: {
        id: materialId,
        teacherId: teacherId
      }
    });

    if (!material) {
      return res.status(404).render('error/404', { title: 'Material Not Found' });
    }

    const fs = require('fs');
    const path = require('path');

    if (!material.fileUrl || !fs.existsSync(material.fileUrl)) {
      return res.status(404).render('error/404', { title: 'File Not Found' });
    }

    const filename = path.basename(material.fileUrl);
    const originalFilename = material.title + path.extname(material.fileUrl);

    res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const fileStream = fs.createReadStream(material.fileUrl);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Download material error:', error);
    res.status(500).render('error/500', { title: 'Download Error' });
  }
};

// ========== STUDENT MANAGEMENT ==========

// Get students
exports.viewStudents = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log('🔍 Loading students for teacher:', teacherId);

    // First verify teacher and include user data - THIS IS CRITICAL
    const teacher = await prisma.teacher.findUnique({
      where: { 
        id: teacherId 
      },
      include: { 
        user: true 
      }
    });

    if (!teacher) {
      return res.status(404).render('error/404', { title: 'Teacher Not Found' });
    }

    // Get teacher's classes with enrollments and students
    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId
      },
      include: {
        enrollments: {
          include: {
            student: {
              include: {
                user: true,
                enrollments: {
                  include: {
                    class: {
                      include: {
                        teacher: {
                          include: {
                            user: true
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    // Get all unique students from all classes
    const allStudents = [];
    const studentMap = new Map();

    classes.forEach(cls => {
      cls.enrollments.forEach(enrollment => {
        if (!studentMap.has(enrollment.student.id)) {
          studentMap.set(enrollment.student.id, true);
          allStudents.push(enrollment.student);
        }
      });
    });

    // Get counts for statistics
    const assignmentsCount = await prisma.assignment.count({
      where: {
        teacherId: teacherId
      }
    });

    const examsCount = await prisma.exam.count({
      where: {
        teacherId: teacherId
      }
    });

    res.render('teacher/students', {
      title: 'Student Management',
      teacher: teacher,
      students: allStudents,
      classes: classes,
      assignmentsCount,
      examsCount,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get student profile data for modal
exports.getStudentProfile = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const studentId = req.params.id; // String ID

    console.log('📋 Getting profile for student:', studentId);

    // Verify the student is in teacher's class
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: studentId, // Add studentId here
        class: {
          teacherId: teacherId
        }
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                avatar: true,
                idNumber: true,
                isActive: true,
                createdAt: true
              }
            },
            enrollments: {
              include: {
                class: {
                  select: {
                    id: true,
                    name: true,
                    grade: true,
                    section: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!enrollment) {
      console.error('❌ Student not found in teacher classes');
      return res.status(404).json({
        success: false,
        message: 'Student not found in your classes'
      });
    }

    const student = enrollment.student;
    console.log('✅ Student profile found:', student.user.firstName);

    // Get assignment statistics for this student
    const assignments = await prisma.assignment.findMany({
      where: {
        class: {
          teacherId: teacherId
        }
      },
      include: {
        submissions: {
          where: {
            studentId: studentId
          }
        }
      }
    });

    const submittedAssignments = assignments.filter(a =>
      a.submissions.length > 0
    ).length;

    const gradedAssignments = assignments.filter(a =>
      a.submissions.some(s => s.score !== null)
    ).length;

    // Get exam statistics
    const exams = await prisma.exam.findMany({
      where: {
        class: {
          teacherId: teacherId
        }
      },
      include: {
        attempts: {
          where: {
            studentId: studentId
          }
        }
      }
    });

    const attemptedExams = exams.filter(e => e.attempts.length > 0).length;

    // Get class work statistics
    const classWorks = await prisma.classWork.findMany({
      where: {
        class: {
          teacherId: teacherId
        }
      },
      include: {
        submissions: {
          where: {
            studentId: studentId
          }
        }
      }
    });

    const submittedClassWorks = classWorks.filter(cw =>
      cw.submissions.length > 0
    ).length;

    res.json({
      success: true,
      profile: {
        id: student.id,
        name: `${student.user.firstName} ${student.user.lastName}`,
        idNumber: student.user.idNumber,
        email: student.user.email,
        phone: student.user.phone,
        avatar: student.user.avatar,
        status: student.user.isActive ? 'Active' : 'Inactive',
        joinDate: student.user.createdAt ? student.user.createdAt.toISOString().split('T')[0] : 'Unknown',
        classes: student.enrollments ? student.enrollments.map(e => e.class ? e.class.name : 'Unknown') : [],
        statistics: {
          assignmentsSubmitted: submittedAssignments,
          assignmentsGraded: gradedAssignments,
          examsAttempted: attemptedExams,
          classWorksSubmitted: submittedClassWorks,
          totalClasses: student.enrollments ? student.enrollments.length : 0
        }
      }
    });

  } catch (error) {
    console.error('❌ Get student profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load student profile: ' + error.message
    });
  }
};

// Get student progress data
exports.getStudentProgress = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const studentId = req.params.id; // Use string ID directly (already string from route)

    console.log('📊 Getting progress for student:', studentId, 'by teacher:', teacherId);

    // Verify the student is in teacher's class
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: studentId, // Add studentId to where clause
        class: {
          teacherId: teacherId
        }
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    if (!enrollment) {
      console.error(`❌ Student ${studentId} not found in teacher ${teacherId}'s classes`);
      return res.status(404).json({
        success: false,
        message: 'Student not found in your classes'
      });
    }

    const student = enrollment.student;
    console.log('✅ Student found:', student.user.firstName, student.user.lastName);

    // Get all assignments with submissions for this student in teacher's classes
    const assignments = await prisma.assignment.findMany({
      where: {
        class: {
          teacherId: teacherId
        }
      },
      include: {
        submissions: {
          where: {
            studentId: studentId
          }
        },
        class: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        dueDate: 'desc'
      }
    });

    // Get all exam attempts for this student in teacher's classes
    const examAttempts = await prisma.examAttempt.findMany({
      where: {
        studentId: studentId,
        exam: {
          class: {
            teacherId: teacherId
          }
        }
      },
      include: {
        exam: {
          select: {
            title: true,
            totalMarks: true,
            date: true
          }
        }
      },
      orderBy: {
        submittedAt: 'desc'
      }
    });

    // Get class work submissions for this student
    const classWorkSubmissions = await prisma.classWorkSubmission.findMany({
      where: {
        studentId: studentId,
        classWork: {
          class: {
            teacherId: teacherId
          }
        }
      },
      include: {
        classWork: {
          select: {
            title: true,
            points: true,
            dueDate: true
          }
        }
      },
      orderBy: {
        submittedAt: 'desc'
      }
    });

    // Calculate overall progress
    const totalAssignments = assignments.length;
    const submittedAssignments = assignments.filter(a => a.submissions.length > 0).length;
    const progressPercentage = totalAssignments > 0 ?
      Math.round((submittedAssignments / totalAssignments) * 100) : 0;

    // Calculate average scores
    const gradedSubmissions = assignments.flatMap(a =>
      a.submissions.filter(s => s.score !== null)
    );
    const assignmentAverage = gradedSubmissions.length > 0 ?
      Math.round(gradedSubmissions.reduce((sum, s) => sum + s.score, 0) / gradedSubmissions.length) : 0;

    const examAverage = examAttempts.length > 0 ?
      Math.round(examAttempts.reduce((sum, e) => sum + e.score, 0) / examAttempts.length) : 0;

    // Calculate class work average
    const gradedClassWorks = classWorkSubmissions.filter(cws => cws.score !== null);
    const classWorkAverage = gradedClassWorks.length > 0 ?
      Math.round(gradedClassWorks.reduce((sum, cws) => sum + cws.score, 0) / gradedClassWorks.length) : 0;

    // Get recent activity (last 10 activities)
    const recentSubmissions = await prisma.submission.findMany({
      where: {
        studentId: studentId,
        assignment: {
          class: {
            teacherId: teacherId
          }
        }
      },
      include: {
        assignment: {
          select: {
            title: true
          }
        }
      },
      orderBy: {
        submittedAt: 'desc'
      },
      take: 5
    });

    const recentClassWorks = await prisma.classWorkSubmission.findMany({
      where: {
        studentId: studentId,
        classWork: {
          class: {
            teacherId: teacherId
          }
        }
      },
      include: {
        classWork: {
          select: {
            title: true
          }
        }
      },
      orderBy: {
        submittedAt: 'desc'
      },
      take: 5
    });

    // Combine and sort recent activity
    const recentActivity = [
      ...recentSubmissions.map(sub => ({
        type: 'Assignment',
        description: `Submitted "${sub.assignment.title}"`,
        date: sub.submittedAt ? sub.submittedAt.toISOString().split('T')[0] : 'Unknown',
        score: sub.score
      })),
      ...recentClassWorks.map(cws => ({
        type: 'Class Work',
        description: `Submitted "${cws.classWork.title}"`,
        date: cws.submittedAt ? cws.submittedAt.toISOString().split('T')[0] : 'Unknown',
        score: cws.score
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    console.log(`✅ Progress calculated: ${progressPercentage}% overall, ${assignmentAverage} avg assignment`);

    res.json({
      success: true,
      progress: {
        studentName: `${student.user.firstName} ${student.user.lastName}`,
        overallProgress: progressPercentage,
        assignmentAverage: assignmentAverage,
        examAverage: examAverage,
        classWorkAverage: classWorkAverage,
        assignments: assignments.map(assignment => ({
          name: assignment.title,
          score: assignment.submissions[0]?.score || null,
          maxScore: assignment.points || 100,
          status: assignment.submissions.length > 0 ?
            (assignment.submissions[0].score !== null ? 'Graded' : 'Submitted') : 'Pending',
          dueDate: assignment.dueDate ? assignment.dueDate.toISOString().split('T')[0] : 'No due date',
          class: assignment.class.name
        })),
        exams: examAttempts.map(attempt => ({
          name: attempt.exam.title,
          score: attempt.score,
          maxScore: attempt.exam.totalMarks,
          date: attempt.exam.date ? attempt.exam.date.toISOString().split('T')[0] : 'Unknown'
        })),
        classWorks: classWorkSubmissions.map(cws => ({
          name: cws.classWork.title,
          score: cws.score,
          maxScore: cws.classWork.points,
          status: cws.score !== null ? 'Graded' : 'Submitted',
          dueDate: cws.classWork.dueDate ? cws.classWork.dueDate.toISOString().split('T')[0] : 'No due date'
        })),
        recentActivity: recentActivity,
        statistics: {
          totalAssignments: totalAssignments,
          submittedAssignments: submittedAssignments,
          gradedAssignments: gradedSubmissions.length,
          examsAttempted: examAttempts.length,
          classWorksSubmitted: classWorkSubmissions.length,
          classWorksGraded: gradedClassWorks.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Get student progress error:', error);
    console.error('Error details:', error.message, error.code);
    
    res.status(500).json({
      success: false,
      message: 'Failed to load student progress: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Get pending submissions count for API
exports.getPendingSubmissionsCount = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    
    // Count assignment submissions that are not graded
    const pendingCount = await prisma.submission.count({
      where: {
        grade: null,
        assignment: {
          teacherId: teacherId
        }
      }
    });

    // Count class work submissions that aren't graded
    const pendingClassWorksCount = await prisma.classWorkSubmission.count({
      where: {
        score: null,
        classWork: {
          teacherId: teacherId
        }
      }
    });

    const totalPending = pendingCount + pendingClassWorksCount;

    res.json({
      success: true,
      count: totalPending
    });
  } catch (error) {
    console.error('Get pending submissions count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load pending submissions count',
      count: 0
    });
  }
};

// ========== CLASS WORKS MANAGEMENT ==========

// View all class works for teacher
exports.viewClassWorks = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`📚 Teacher viewing class works, teacherId: ${teacherId}`);

    // Get teacher with classes
    const teacher = await prisma.teacher.findUnique({
      where: {
        id: teacherId
      },
      include: {
        user: true,
        classes: {
          include: {
            _count: {
              select: {
                enrollments: true
              }
            }
          }
        }
      }
    });

    if (!teacher) {
      return res.status(404).render('error/404', { title: 'Teacher Not Found' });
    }

    // Get class works for all teacher's classes
    const classWorks = await prisma.classWork.findMany({
      where: {
        classId: {
          in: teacher.classes.map(c => c.id)
        }
      },
      include: {
        class: {
          select: {
            name: true,
            _count: {
              select: {
                enrollments: true
              }
            }
          }
        },
        _count: {
          select: {
            submissions: true
          }
        },
        submissions: {
          include: {
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
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Calculate stats
    const stats = {
      totalClassWorks: classWorks.length,
      activeClassWorks: classWorks.filter(cw => cw.isActive).length,
      pendingSubmissions: classWorks.reduce((acc, cw) =>
        acc + cw.submissions.filter(s => s.status === 'submitted').length, 0),
      totalSubmissions: classWorks.reduce((acc, cw) => acc + cw.submissions.length, 0)
    };

    res.render('teacher/class-works', {
      title: 'Manage Class Works',
      classWorks,
      stats,
      teacher,
      user: teacher.user,
      userSchool,
      isSuperAdmin
    });

  } catch (error) {
    console.error('❌ Error in viewClassWorks:', error);
    res.status(500).render('error/500', {
      title: 'Server Error',
      message: 'Failed to load class works'
    });
  }
};

// Create class work form
exports.createClassWorkForm = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: {
        user: true,
        classes: true
      }
    });

    res.render('teacher/create-class-work', {
      title: 'Create Class Work',
      teacher,
      user: teacher.user,
      classes: teacher.classes,
      userSchool,
      isSuperAdmin
    });

  } catch (error) {
    console.error('❌ Error in createClassWorkForm:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Create class work
exports.createClassWork = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const { title, description, type, classId, points, dueDate, questions } = req.body;

    console.log('Creating class work:', { title, classId, teacherId });

    // Basic validation
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    if (!classId) {
      return res.status(400).json({
        success: false,
        message: 'Please select a class'
      });
    }

    // Use string IDs directly
    const classWork = await prisma.classWork.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        type: type || 'assignment',
        points: points ? parseInt(points) : 100,
        dueDate: dueDate ? new Date(dueDate) : null,
        questions: questions ? (typeof questions === 'string' ? JSON.parse(questions) : questions) : [],
        classId: classId,  // String ID
        teacherId: teacherId,  // String ID
        isActive: true,
        createdAt: new Date()
      }
    });

    console.log('✅ Class work created:', classWork.id);

    // Create notifications for students
    const classStudents = await prisma.enrollment.findMany({
      where: { classId: classId },
      include: { student: true }
    });

    for (const enrollment of classStudents) {
      await createNotification(
        enrollment.student.userId,
        'New Class Work',
        `New ${type || 'assignment'} "${title}" has been assigned`,
        'fa-tasks'
      );
    }

    res.json({
      success: true,
      message: 'Class work created successfully',
      classWorkId: classWork.id
    });

  } catch (error) {
    console.error('❌ Error in createClassWork:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create class work: ' + error.message
    });
  }
};

// Edit class work form
exports.editClassWorkForm = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const classWorkId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const classWork = await prisma.classWork.findFirst({
      where: {
        id: classWorkId,
        teacherId: teacherId
      },
      include: {
        class: true
      }
    });

    if (!classWork) {
      req.flash('error', 'Class work not found');
      return res.redirect('/teacher/class-works');
    }

    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId
      }
    });

    res.render('teacher/edit-class-work', {
      title: 'Edit Class Work',
      classWork: classWork,
      classes: classes,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Edit class work form error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Update class work
exports.updateClassWork = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const classWorkId = parseInt(req.params.id);
    const { title, description, classId, dueDate, questions } = req.body;

    let parsedQuestions = [];
    if (questions && typeof questions === 'string') {
      try {
        parsedQuestions = JSON.parse(questions);
      } catch (e) {
        console.error('Error parsing questions:', e);
      }
    }

    await prisma.classWork.update({
      where: {
        id: classWorkId,
        teacherId: teacherId
      },
      data: {
        title,
        description,
        classId: parseInt(classId),
        dueDate: new Date(dueDate),
        questions: parsedQuestions
      }
    });

    req.flash('success', 'Class work updated successfully');
    res.redirect('/teacher/class-works');
  } catch (error) {
    console.error('Update class work error:', error);
    req.flash('error', 'Failed to update class work');
    res.redirect(`/teacher/class-works/${classWorkId}/edit`);
  }
};

// Delete class work
exports.deleteClassWork = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const classWorkId = parseInt(req.params.id);

    await prisma.classWork.delete({
      where: {
        id: classWorkId,
        teacherId: teacherId
      }
    });

    res.json({
      success: true,
      message: 'Class work deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error in deleteClassWork:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete class work'
    });
  }
};

// View class work submissions
// In teacherController.js, around line 2807
exports.viewSubmissions = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get class work with submissions
        const classWork = await prisma.classWork.findUnique({
            where: { id },
            include: {
                class: true,
                submissions: {
                    include: {
                        student: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                email: true,
                                avatar: true
                            }
                        }
                    },
                    orderBy: {
                        submittedAt: 'desc'
                    }
                },
                _count: {
                    select: {
                        submissions: true
                    }
                }
            }
        });

        if (!classWork) {
            req.flash('error', 'Class work not found');
            return res.redirect('/teacher/class-works');
        }

        // Calculate stats
        const submissions = classWork.submissions || [];
        const gradedCount = submissions.filter(s => s.status === 'graded').length;
        const pendingCount = submissions.filter(s => s.status === 'submitted').length;
        
        // Get total students in the class (if class exists)
        let totalStudents = 0;
        if (classWork.classId) {
            const classData = await prisma.class.findUnique({
                where: { id: classWork.classId },
                include: {
                    _count: {
                        select: {
                            students: true
                        }
                    }
                }
            });
            totalStudents = classData?._count?.students || 0;
        }

        res.render('teacher/class-work-submissions', {
            title: `Submissions: ${classWork.title}`,
            classWork,
            submissions,
            totalStudents,
            gradedCount,
            pendingCount,
            user: req.user,
            userSchool: req.user.school,
            isSuperAdmin: req.user.role === 'admin' && req.adminInfo?.roleLevel === 'superadmin'
        });
    } catch (error) {
        console.error('Error viewing submissions:', error);
        req.flash('error', 'Failed to load submissions');
        res.redirect('/teacher/class-works');
    }
};

// ========== LIVE SESSIONS MANAGEMENT ==========

// View all live sessions for teacher
exports.viewLiveSessions = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log(`🎥 Teacher viewing live sessions, teacherId: ${teacherId}`);

    // Get teacher with classes
    const teacher = await prisma.teacher.findUnique({
      where: {
        id: teacherId
      },
      include: {
        user: true,
        classes: true  // Make sure to include classes
      }
    });

    if (!teacher) {
      return res.status(404).render('error/404', { title: 'Teacher Not Found' });
    }

    // Get live sessions for all teacher's classes
    const liveSessions = await prisma.liveSession.findMany({
      where: {
        teacherId: teacherId  // Use teacherId directly if that's the relation
      },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            grade: true,
            section: true
          }
        },
        _count: {
          select: {
            participants: true
          }
        },
        participants: {
          include: {
            student: {
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
        }
      },
      orderBy: {
        startTime: 'desc'
      }
    });

    // Calculate stats
    const now = new Date();
    const stats = {
      totalSessions: liveSessions.length,
      liveSessions: liveSessions.filter(ls => {
        const start = new Date(ls.startTime);
        const end = ls.endTime ? new Date(ls.endTime) : null;
        return now >= start && (!end || now <= end);
      }).length,
      scheduledSessions: liveSessions.filter(ls => new Date(ls.startTime) > now).length,
      totalParticipants: liveSessions.reduce((acc, ls) => acc + ls.participants.length, 0)
    };

    console.log(`✅ Loaded ${liveSessions.length} live sessions for teacher`);

    res.render('teacher/live-sessions', {
      title: 'Manage Live Sessions',
      liveSessions: liveSessions,
      stats: stats,
      teacher: teacher,
      user: teacher.user,
      classes: teacher.classes,  // CRITICAL: Pass classes to the view
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('❌ Error in viewLiveSessions:', error);
    res.status(500).render('error/500', {
      title: 'Server Error',
      message: 'Failed to load live sessions: ' + error.message
    });
  }
};

// Create live session form
exports.createLiveSessionForm = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const teacher = await prisma.teacher.findUnique({
      where: { 
        id: teacherId 
      },
      include: {
        user: true,
        classes: true  // Make sure to include classes
      }
    });

    if (!teacher) {
      return res.status(404).render('error/404', { title: 'Teacher Not Found' });
    }

    res.render('teacher/create-live-session', {
      title: 'Schedule Live Session',
      teacher: teacher,
      user: teacher.user,
      classes: teacher.classes,  // CRITICAL: Pass classes to the view
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });

  } catch (error) {
    console.error('❌ Error in createLiveSessionForm:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      message: 'Failed to load form: ' + error.message
    });
  }
};

// Create live session
exports.createLiveSession = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const { title, description, classId, startTime, endTime, meetingLink } = req.body;

    console.log('🔔 Create live session request:', { 
      title, description, classId, startTime, endTime, meetingLink, teacherId 
    });

    // Basic validation
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    if (!classId) {
      console.error('❌ No classId provided');
      return res.status(400).json({
        success: false,
        message: 'Please select a class'
      });
    }

    if (!startTime) {
      return res.status(400).json({
        success: false,
        message: 'Start time is required'
      });
    }

    // Parse classId - handle both string and number
    let parsedClassId;
    if (typeof classId === 'string') {
      // Check if it's already a string ID or needs parsing
      if (classId.includes('cmim')) {
        // It's a string ID like "cmim..."
        parsedClassId = classId;
      } else {
        // Try to parse as integer
        const numId = parseInt(classId);
        if (isNaN(numId)) {
          console.error('❌ Invalid classId format:', classId);
          return res.status(400).json({
            success: false,
            message: 'Invalid class ID format'
          });
        }
        parsedClassId = numId;
      }
    } else if (typeof classId === 'number') {
      parsedClassId = classId;
    } else {
      console.error('❌ Unexpected classId type:', typeof classId, classId);
      return res.status(400).json({
        success: false,
        message: 'Invalid class ID'
      });
    }

    console.log('📝 Creating live session with classId:', parsedClassId);

    // Check if class exists and belongs to teacher
    const classExists = await prisma.class.findFirst({
      where: {
        id: parsedClassId,
        teacherId: teacherId
      }
    });

    if (!classExists) {
      console.error(`❌ Class ${parsedClassId} not found for teacher ${teacherId}`);
      return res.status(404).json({
        success: false,
        message: 'Class not found or you do not have permission'
      });
    }

    // Create the live session - ADJUST BASED ON YOUR PRISMA SCHEMA
    const liveSession = await prisma.liveSession.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        meetingLink: meetingLink || `https://meet.google.com/${Math.random().toString(36).substr(2, 9)}`,
        // Use relation fields if your schema requires them
        class: {
          connect: { id: parsedClassId }
        },
        teacher: {
          connect: { id: teacherId }
        },
        isActive: true,
        createdAt: new Date()
      }
    });

    console.log('✅ Live session created successfully with ID:', liveSession.id);

    // Create notifications for students
    const classStudents = await prisma.enrollment.findMany({
      where: { classId: parsedClassId },
      include: { student: true }
    });

    for (const enrollment of classStudents) {
      await createNotification(
        enrollment.student.userId,
        'Live Session Scheduled',
        `Live session "${title}" is scheduled for ${new Date(startTime).toLocaleDateString()} at ${new Date(startTime).toLocaleTimeString()}`,
        'fa-video'
      );
    }

    res.json({
      success: true,
      message: 'Live session scheduled successfully',
      sessionId: liveSession.id
    });

  } catch (error) {
    console.error('❌ Error in createLiveSession:', error);
    console.error('Error details:', error.message, error.code, error.meta);
    
    // Handle specific Prisma errors
    let errorMessage = 'Failed to schedule live session';
    if (error.code === 'P2003') {
      errorMessage = 'Invalid class ID or teacher ID';
    } else if (error.code === 'P2016') {
      errorMessage = 'Invalid relation - class or teacher not found';
    } else if (error.message.includes('class')) {
      errorMessage = 'Database error with class relation';
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Edit live session form
exports.editLiveSessionForm = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const sessionId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const liveSession = await prisma.liveSession.findFirst({
      where: {
        id: sessionId,
        teacherId: teacherId
      },
      include: {
        class: true
      }
    });

    if (!liveSession) {
      req.flash('error', 'Live session not found');
      return res.redirect('/teacher/live-sessions');
    }

    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId
      }
    });

    res.render('teacher/edit-live-session', {
      title: 'Edit Live Session',
      liveSession: liveSession,
      classes: classes,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Edit live session form error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Update live session
exports.updateLiveSession = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const sessionId = parseInt(req.params.id);
    const { title, description, classId, startTime, endTime } = req.body;

    await prisma.liveSession.update({
      where: {
        id: sessionId,
        teacherId: teacherId
      },
      data: {
        title,
        description,
        classId: parseInt(classId),
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null
      }
    });

    req.flash('success', 'Live session updated successfully');
    res.redirect('/teacher/live-sessions');
  } catch (error) {
    console.error('Update live session error:', error);
    req.flash('error', 'Failed to update live session');
    res.redirect(`/teacher/live-sessions/${sessionId}/edit`);
  }
};

// Delete live session
exports.deleteLiveSession = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const sessionId = parseInt(req.params.id);

    await prisma.liveSession.delete({
      where: {
        id: sessionId,
        teacherId: teacherId
      }
    });

    res.json({
      success: true,
      message: 'Live session deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error in deleteLiveSession:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete live session'
    });
  }
};

// In teacherController.js
exports.getSubmissionDetails = async (req, res) => {
    try {
        const { id } = req.params;
        
        const submission = await prisma.submission.findUnique({
            where: { id },
            include: {
                student: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        avatar: true
                    }
                },
                classWork: {
                    include: {
                        questions: true
                    }
                }
            }
        });

        if (!submission) {
            return res.status(404).json({ success: false, message: 'Submission not found' });
        }

        res.json({ success: true, submission, classWork: submission.classWork });
    } catch (error) {
        console.error('Error getting submission details:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.gradeSubmission = async (req, res) => {
    try {
        const { id } = req.params;
        const { score, grade, feedback } = req.body;
        
        const submission = await prisma.submission.update({
            where: { id },
            data: {
                score: parseFloat(score),
                grade: grade || null,
                feedback: feedback || null,
                status: 'graded',
                gradedAt: new Date()
            }
        });

        res.json({ success: true, submission });
    } catch (error) {
        console.error('Error grading submission:', error);
        res.status(500).json({ success: false, message: 'Failed to grade submission' });
    }
};

// Delete material - FIXED
exports.deleteMaterial = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const materialId = req.params.id; // String ID

    console.log('🗑️ Deleting material:', { materialId, teacherId });

    // Check if material exists and belongs to teacher
    const existingMaterial = await prisma.material.findFirst({
      where: {
        id: materialId,
        teacherId: teacherId
      }
    });

    if (!existingMaterial) {
      return res.status(404).json({
        success: false,
        message: 'Material not found or unauthorized'
      });
    }

    // Delete associated views first
    await prisma.materialView.deleteMany({
      where: {
        materialId: materialId
      }
    });

    // Delete the material
    await prisma.material.delete({
      where: {
        id: materialId
      }
    });

    console.log('✅ Material deleted:', materialId);

    res.json({
      success: true,
      message: 'Material deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete material error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete material: ' + error.message
    });
  }
};

exports.getMaterialStats = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_materials,
        COUNT(DISTINCT classId) as classes_with_materials,
        COUNT(CASE WHEN type = 'document' THEN 1 END) as document_count,
        COUNT(CASE WHEN type = 'video' THEN 1 END) as video_count,
        COUNT(CASE WHEN type = 'presentation' THEN 1 END) as presentation_count,
        COUNT(CASE WHEN isPublic = true THEN 1 END) as public_count,
        SUM(mv.view_count) as total_views
      FROM materials m
      LEFT JOIN (
        SELECT materialId, COUNT(*) as view_count
        FROM material_views
        GROUP BY materialId
      ) mv ON m.id = mv.materialId
      WHERE m.teacherId = ${teacherId}
    `;

    res.json({
      success: true,
      stats: stats[0]
    });
  } catch (error) {
    console.error('❌ Get material stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load material statistics'
    });
  }
};

exports.updateMaterial = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const materialId = req.params.id;
    const { title, description, type, category, classId, isPublic } = req.body;

    console.log('📝 Updating material:', { materialId, teacherId });

    // Check if material exists and belongs to teacher
    const existingMaterial = await prisma.material.findFirst({
      where: {
        id: materialId,
        teacherId: teacherId
      }
    });

    if (!existingMaterial) {
      return res.status(404).json({
        success: false,
        message: 'Material not found or unauthorized'
      });
    }

    // Parse classId - handle empty string
    let parsedClassId = null;
    if (classId && classId !== '' && classId !== 'null' && classId !== 'all') {
      parsedClassId = classId;
    }

    // Parse isPublic
    const isMaterialPublic = isPublic === 'on' || isPublic === true || isPublic === 'true';

    // Update the material
    const updatedMaterial = await prisma.material.update({
      where: {
        id: materialId
      },
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        type: type || existingMaterial.type,
        category: category || existingMaterial.category,
        classId: parsedClassId,
        isPublic: isMaterialPublic,
        updatedAt: new Date()
      },
      include: {
        class: {
          select: {
            name: true
          }
        }
      }
    });

    console.log('✅ Material updated:', materialId);

    res.json({
      success: true,
      message: 'Material updated successfully',
      material: updatedMaterial
    });

  } catch (error) {
    console.error('❌ Update material error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update material: ' + error.message
    });
  }
};

// Add this function to your exports or pass it to the view
exports.getMaterialIcon = function(type) {
  const iconMap = {
    textbook: 'fa-book',
    video: 'fa-video',
    document: 'fa-file-pdf',
    presentation: 'fa-presentation-screen',
    other: 'fa-file'
  };
  return iconMap[type] || 'fa-file';
};

// ========== CLASS WORK QUESTIONS PARSING ==========
/**
 * POST /teacher/class-works/parse-questions
 * Parses uploaded .txt or .docx file and returns array of question objects
 */
exports.parseClassWorkQuestions = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let questions = [];

    if (fileExt === '.txt') {
      const text = req.file.buffer.toString('utf8');
      questions = parseTextContent(text);
    } else if (fileExt === '.docx') {
      questions = await parseDocx(req.file.buffer);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Unsupported file type. Please upload .txt or .docx files.'
      });
    }

    if (!questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid questions could be extracted from the file.'
      });
    }

    if (questions.length > 100) questions = questions.slice(0, 100);
    console.log(`✅ Parsed ${questions.length} class work questions from ${req.file.originalname}`);
    res.json({ success: true, questions });

  } catch (error) {
    console.error('❌ Class work question parsing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to parse questions: ' + error.message
    });
  }
};