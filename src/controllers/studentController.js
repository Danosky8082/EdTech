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
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Expire in 7 days
      }
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
};

// Student dashboard - FIXED QUERY (removed where from user include)
const dashboard = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Get student with classes and enrollments - FIXED QUERY
    const student = await prisma.student.findUnique({
      where: { 
        id: studentId
      },
      include: {
        user: true, // Remove where from user include
        enrollments: {
          where: isSuperAdmin ? {} : {
            class: {
              teacher: {
                user: {
                  school: userSchool
                }
              }
            }
          },
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
    });

    if (!student) {
      return res.status(404).render('error/404', { title: 'Student Not Found' });
    }

    // Check if student belongs to the school (unless super admin)
    if (!isSuperAdmin && (!student.user || student.user.school !== userSchool)) {
      return res.status(403).render('error/403', { 
        title: 'Access Denied',
        message: 'You do not have access to this school' 
      });
    }

    // Get class IDs for queries
    const classIds = student.enrollments.map(e => e.classId);
    
    // Get upcoming assignments only if student has enrollments - UPDATED QUERY
    let upcomingAssignments = [];
    if (classIds.length > 0) {
      upcomingAssignments = await prisma.assignment.findMany({
        where: {
          classId: {
            in: classIds
          },
          dueDate: {
            gt: new Date()
          },
          ...(isSuperAdmin ? {} : {
            class: {
              teacher: {
                user: {
                  school: userSchool
                }
              }
            }
          })
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
          dueDate: 'asc'
        },
        take: 5
      });
    }

    // Calculate completed assignments count - UPDATED QUERY
    let completedAssignments = 0;
    if (classIds.length > 0) {
      const submissions = await prisma.submission.count({
        where: {
          studentId: studentId,
          assignment: {
            classId: {
              in: classIds
            },
            ...(isSuperAdmin ? {} : {
              class: {
                teacher: {
                  user: {
                    school: userSchool
                  }
                }
              }
            })
          }
        }
      });
      completedAssignments = submissions;
    }

    // Generate notifications for upcoming assignments
    if (upcomingAssignments.length > 0) {
      const closestAssignment = upcomingAssignments[0];
      const daysUntilDue = Math.ceil((closestAssignment.dueDate - new Date()) / (1000 * 60 * 60 * 24));
      
      if (daysUntilDue <= 3) {
        // Check if notification already exists
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: userId,
            message: { contains: `${closestAssignment.title} is due in ${daysUntilDue}` }
          }
        });

        if (!existingNotification) {
          await createNotification(
            userId,
            'Assignment Due Soon',
            `${closestAssignment.title} is due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`,
            'fa-tasks'
          );
        }
      }
    }

    // Generate notifications for new grades (assignments) - UPDATED QUERY
    if (classIds.length > 0) {
      const recentGradedSubmissions = await prisma.submission.findMany({
        where: {
          studentId: studentId,
          grade: { not: null },
          assignment: {
            classId: { in: classIds },
            ...(isSuperAdmin ? {} : {
              class: {
                teacher: {
                  user: {
                    school: userSchool
                  }
                }
              }
            })
          },
          submittedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        },
        include: {
          assignment: true
        },
        orderBy: {
          submittedAt: 'desc'
        },
        take: 3
      });

      for (const submission of recentGradedSubmissions) {
        // Check if notification already exists for this grade
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: userId,
            message: { contains: `grade of ${submission.grade} for ${submission.assignment.title}` }
          }
        });

        if (!existingNotification) {
          await createNotification(
            userId,
            'New Grade Available',
            `You received a grade of ${submission.grade} for ${submission.assignment.title}`,
            'fa-check-circle'
          );
        }
      }
    }

    // Generate notifications for published exam results - UPDATED QUERY
    if (classIds.length > 0) {
      const publishedExamResults = await prisma.examAttempt.findMany({
        where: {
          studentId: studentId,
          status: 'published',
          gradedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          },
          ...(isSuperAdmin ? {} : {
            exam: {
              class: {
                teacher: {
                  user: {
                    school: userSchool
                  }
                }
              }
            }
          })
        },
        include: {
          exam: true
        },
        orderBy: {
          gradedAt: 'desc'
        },
        take: 5
      });

      for (const result of publishedExamResults) {
        // Check if notification already exists for this exam result
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: userId,
            message: { contains: `results for "${result.exam.title}"` }
          }
        });

        if (!existingNotification) {
          await createNotification(
            userId,
            'Exam Results Published',
            `Your results for "${result.exam.title}" have been published. Check your exam results!`,
            'fa-chart-bar'
          );
        }
      }
    }

    // Get only unread notifications from database
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

    res.render('student/dashboard', {
      title: 'Student Dashboard',
      user: student.user,
      student,
      enrollments: student.enrollments,
      upcomingAssignments,
      completedAssignments,
      notifications: formattedNotifications,
      notificationCount,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin
    });
  } catch (error) {
    console.error('Student dashboard error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// ========== ASSIGNMENT FUNCTIONS ==========

// Get class assignments for student - UPDATED with isSuperAdmin
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

    // Get assignments for this class with student's submissions - UPDATED QUERY
    const assignments = await prisma.assignment.findMany({
      where: {
        classId: classId,
        ...(isSuperAdmin ? {} : {
          class: {
            teacher: {
              user: {
                school: userSchool
              }
            }
          }
        })
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
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get class assignments error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get submission page - UPDATED with isSuperAdmin
const getSubmissionPage = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.id);
    const { type } = req.query;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get assignment and verify student has access - UPDATED QUERY
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { studentId: studentId }
            },
            ...(isSuperAdmin ? {} : {
              teacher: {
                user: {
                  school: userSchool
                }
              }
            })
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
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get submission page error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Enhanced submission page (rich text/drawing) - UPDATED with isSuperAdmin
const getEnhancedSubmissionPage = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.id);
    const { type } = req.query;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get assignment and verify student has access - UPDATED QUERY
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { studentId: studentId }
            },
            ...(isSuperAdmin ? {} : {
              teacher: {
                user: {
                  school: userSchool
                }
              }
            })
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
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get enhanced submission page error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Submit assignment (file upload) - UPDATED with isSuperAdmin
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

    // Get assignment and verify student has access - FIXED QUERY
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {  // ADD THIS
            teacher: {
              include: {  // ADD THIS
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
      }
    });

    if (!assignment) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check school access
    if (!isSuperAdmin && assignment.class.teacher.user.school !== userSchool) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: School mismatch'
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
          grade: null, // Reset grade if resubmitting
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

// Submit enhanced assignment (text/drawing) - UPDATED with isSuperAdmin
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

    // Get assignment and verify student has access - FIXED QUERY
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {  // ADD THIS
            teacher: {
              include: {  // ADD THIS
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
      }
    });

    if (!assignment) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check school access
    if (!isSuperAdmin && assignment.class.teacher.user.school !== userSchool) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: School mismatch'
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

// View materials - UPDATED with isSuperAdmin
const viewMaterials = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const classId = parseInt(req.params.classId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    console.log('🔍 ViewMaterials called:', { studentId, classId, userSchool });

    if (!studentId) {
      return res.status(401).render('error/401', { title: 'Unauthorized' });
    }

    // Verify student is enrolled in the class AND belongs to same school
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

    // Get class details - FIXED QUERY
const classDetails = await prisma.class.findUnique({
  where: { 
    id: classId
  },
  include: {
    teacher: {
      include: {
        user: {
          // Remove where from include, we'll filter after the query
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

if (!classDetails) {
  return res.status(404).render('error/404', { title: 'Class Not Found' });
}

// Check if teacher belongs to the same school (unless super admin)
if (!isSuperAdmin && classDetails.teacher.user.school !== userSchool) {
  return res.status(403).render('error/403', { 
    title: 'Access Denied',
    message: 'This class teacher does not belong to your school'
  });
}

    // Then get materials - UPDATED QUERY
    // Then get materials - FIXED QUERY
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
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('❌ View materials error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      message: 'Failed to load materials. Please try again.' 
    });
  }
};

// View assignments - UPDATED with isSuperAdmin
const viewAssignments = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const classId = parseInt(req.params.classId);
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

    // Get assignments for the class - UPDATED QUERY
    const assignments = await prisma.assignment.findMany({
      where: { 
        classId: classId,
        ...(isSuperAdmin ? {} : {
          class: {
            teacher: {
              user: {
                school: userSchool
              }
            }
          }
        })
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

    // Get class details - UPDATED QUERY
    const classDetails = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: {
          include: { user: true }
        }
      }
    });

    res.render('student/assignments', {
      title: `Assignments - ${classDetails.name}`,
      assignments: assignments,
      classData: classDetails,
      studentId: studentId,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('View assignments error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get submit assignment page - UPDATED with isSuperAdmin
const getSubmitAssignment = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.assignmentId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get assignment details - UPDATED QUERY
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          ...(isSuperAdmin ? {} : {
            teacher: {
              user: {
                school: userSchool
              }
            }
          })
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
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classId_studentId: {
          classId: assignment.classId,
          studentId: studentId
        }
      }
    });

    if (!enrollment) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    res.render('student/submit-assignment', {
      title: `Submit Assignment - ${assignment.title}`,
      assignment: assignment,
      hasSubmission: assignment.submissions.length > 0,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get submit assignment error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Submit assignment - UPDATED with isSuperAdmin
const submitAssignment = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const assignmentId = parseInt(req.params.assignmentId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    if (!req.file) {
      return res.status(400).render('error/400', { 
        title: 'No File Uploaded',
        message: 'Please select a file to upload.' 
      });
    }
    
    // Check if assignment exists and is not past due - UPDATED QUERY
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          ...(isSuperAdmin ? {} : {
            teacher: {
              user: {
                school: userSchool
              }
            }
          })
        }
      }
    });

    if (!assignment) {
      return res.status(404).render('error/404', { title: 'Assignment Not Found' });
    }

    if (new Date() > assignment.dueDate) {
      return res.status(400).render('error/400', { 
        title: 'Assignment Past Due',
        message: 'This assignment is past the due date and cannot be submitted.' 
      });
    }

    // Create or update submission
    await prisma.submission.upsert({
      where: {
        assignmentId_studentId: {
          assignmentId,
          studentId
        }
      },
      update: {
        fileUrl: req.file.path,
        submittedAt: new Date()
      },
      create: {
        assignmentId,
        studentId,
        fileUrl: req.file.path,
        submittedAt: new Date()
      }
    });

    res.redirect(`/student/class/${assignment.class.id}/assignments?success=Assignment submitted successfully`);
  } catch (error) {
    console.error('Submit assignment error:', error);
    res.status(500).render('error/500', { 
      title: 'Server Error',
      message: 'Failed to submit assignment. Please try again.' 
    });
  }
};

// View classes - UPDATED with isSuperAdmin
const viewClasses = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Get student with enrollments and classes - UPDATED QUERY
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: true,
        enrollments: {
          where: isSuperAdmin ? {} : {
            class: {
              teacher: {
                user: {
                  school: userSchool
                }
              }
            }
          },
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

    // Get completed assignments count - UPDATED QUERY
    const completedAssignments = await prisma.submission.count({
      where: {
        studentId: studentId,
        grade: {
          not: null
        },
        ...(isSuperAdmin ? {} : {
          assignment: {
            class: {
              teacher: {
                user: {
                  school: userSchool
                }
              }
            }
          }
        })
      }
    });

    res.render('student/classes', {
      title: 'My Classes',
      user: student.user,
      enrollments: validEnrollments,
      upcomingAssignments: upcomingAssignments.slice(0, 10),
      completedAssignments: completedAssignments,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('View classes error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// View all assignments across all classes - UPDATED with isSuperAdmin
const viewAllAssignments = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Get student with enrollments to find class IDs - UPDATED QUERY
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        enrollments: {
          where: isSuperAdmin ? {} : {
            class: {
              teacher: {
                user: {
                  school: userSchool
                }
              }
            }
          },
          include: {
            class: true
          }
        }
      }
    });

    const classIds = student.enrollments.map(e => e.classId);
    
    // Get all assignments for the student's classes - UPDATED QUERY
    const assignments = await prisma.assignment.findMany({
      where: {
        classId: {
          in: classIds
        },
        ...(isSuperAdmin ? {} : {
          class: {
            teacher: {
              user: {
                school: userSchool
              }
            }
          }
        })
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
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('View all assignments error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// View all grades across all classes - UPDATED with isSuperAdmin
const viewAllGrades = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Get all graded submissions - UPDATED QUERY
    const gradedSubmissions = await prisma.submission.findMany({
      where: {
        studentId: studentId,
        grade: { not: null },
        ...(isSuperAdmin ? {} : {
          assignment: {
            class: {
              teacher: {
                user: {
                  school: userSchool
                }
              }
            }
          }
        })
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
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('View all grades error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// ========== EXAM FUNCTIONS ==========

// View exams for a class - UPDATED with isSuperAdmin
const viewExams = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const classId = parseInt(req.params.classId);
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

    // Simple exam query without complex relations - UPDATED QUERY
    const exams = await prisma.exam.findMany({
      where: { 
        classId: classId,
        ...(isSuperAdmin ? {} : {
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
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
        totalQuestions: 0, // We'll fix this later based on your schema
        hasAttempt: exam.attempts.length > 0,
        score: exam.attempts.length > 0 ? exam.attempts[0].score : null
      };
    });

    // Get class details - UPDATED QUERY
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
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('View exams error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Take exam - display exam questions - UPDATED with isSuperAdmin
const takeExam = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const examId = parseInt(req.params.examId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get exam - UPDATED QUERY
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

    // Get questions from the exam data (assuming they're stored as JSON)
    const questions = exam.questions || [];

    res.render('student/take-exam', {
      title: `Exam: ${exam.title}`,
      exam: exam,
      attempt: attempt,
      questions: questions,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });

  } catch (error) {
    console.error('Take exam error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Submit exam - UPDATED with isSuperAdmin
const submitExam = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const examId = parseInt(req.params.examId);
    const { answers, timeSpent } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    // Get exam with questions - FIXED QUERY
    const exam = await prisma.exam.findUnique({
      where: { 
        id: examId,
        // Add school filter to the where clause instead of include
        ...(isSuperAdmin ? {} : {
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
      },
      // Only include what you need for the exam logic
      include: {
        teacher: {
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
          // Simple scoring - you can make this more sophisticated
          if (question.type === 'multiple_choice' || question.type === 'true_false') {
            if (studentAnswer === question.correctAnswer) {
              score += question.marks || 1;
            }
          } else if (question.type === 'short_answer') {
            // For short answers, you might want more complex checking
            // For now, give partial credit if answer is provided
            if (studentAnswer.trim().length > 0) {
              score += (question.marks || 1) * 0.5; // 50% for attempting
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

// View exam results - UPDATED with isSuperAdmin
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

    // Calculate total marks - you need to implement this based on your question structure
    let totalMarks = 100; // Default fallback
    
    // If exam has totalMarks field, use it
    if (attempt.exam.totalMarks) {
      totalMarks = attempt.exam.totalMarks;
    } else {
      // Calculate from questions if they exist
      if (attempt.exam.questions && Array.isArray(attempt.exam.questions)) {
        totalMarks = attempt.exam.questions.reduce((total, question) => {
          return total + (question.marks || 1); // Default to 1 mark per question if not specified
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
      isSuperAdmin: isSuperAdmin // ADD THIS
    });

  } catch (error) {
    console.error('View exam results error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// API: Get exam questions for student - UPDATED with isSuperAdmin
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
      questions: exam.questions || [] // Return questions array from exam
    });

  } catch (error) {
    console.error('Get exam questions error:', error);
    res.status(500).json({ error: 'Failed to load exam questions' });
  }
};

// Get enhanced submit assignment page - UPDATED with isSuperAdmin
const getEnhancedSubmitAssignment = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const assignmentId = parseInt(req.params.assignmentId);
        const submissionType = req.query.type || 'text';
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log('📝 Enhanced submission requested:', { assignmentId, submissionType });

        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId },
            include: {
                class: {
                    include: {  // ADD THIS
                        teacher: {
                            include: {  // ADD THIS
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
                },
                submissions: {
                    where: { studentId: studentId }
                }
            }
        });

        if (!assignment) {
            return res.status(404).render('error/404', { title: 'Assignment Not Found' });
        }

        // Check school access
        if (!isSuperAdmin && assignment.class.teacher.user.school !== userSchool) {
            return res.status(403).render('error/403', { 
                title: 'Access Denied',
                message: 'This assignment does not belong to your school'
            });
        }

        // Verify student is enrolled in the class
        const enrollment = await prisma.enrollment.findUnique({
            where: {
                classId_studentId: {
                    classId: assignment.classId,
                    studentId: studentId
                }
            }
        });

        if (!enrollment) {
            return res.status(403).render('error/403', { title: 'Access Denied' });
        }

        // Check if assignment is past due
        if (new Date() > new Date(assignment.dueDate)) {
            return res.status(400).render('error/400', {
                title: 'Assignment Past Due',
                message: 'This assignment is past the due date and cannot be submitted.'
            });
        }

        res.render('student/enhanced-submit-assignment', {
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

// Submit text assignment - UPDATED with isSuperAdmin
const submitTextAssignment = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const assignmentId = parseInt(req.params.assignmentId);
        const { title, content } = req.body;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        console.log('📝 Text submission received:', { assignmentId, title, contentLength: content?.length });

        // Validate input
        if (!title || !content) {
            return res.status(400).json({
                success: false,
                message: 'Title and content are required'
            });
        }

        // Check if assignment exists and is not past due - FIXED QUERY
        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId },
            include: {
                class: {
                    include: {  // ADD THIS
                        teacher: {
                            include: {  // ADD THIS
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
            }
        });

        if (!assignment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Assignment not found' 
            });
        }

        // Check school access
        if (!isSuperAdmin && assignment.class.teacher.user.school !== userSchool) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied: School mismatch' 
            });
        }

        if (new Date() > new Date(assignment.dueDate)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Assignment is past due date' 
            });
        }

        // Calculate word count (simple version - strip HTML tags and count words)
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

// Submit drawing assignment - UPDATED with isSuperAdmin
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
                    include: {  // ADD THIS
                        teacher: {
                            include: {  // ADD THIS
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
            }
        });

        if (!assignment) {
            return res.status(404).json({ 
                success: false, 
                message: 'Assignment not found' 
            });
        }

        // Check school access
        if (!isSuperAdmin && assignment.class.teacher.user.school !== userSchool) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied: School mismatch' 
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

// Get notes for a class - UPDATED with isSuperAdmin
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

        // Verify enrollment - FIXED QUERY
        const enrollment = await prisma.enrollment.findUnique({
            where: {
                classId_studentId: {
                    classId: classId,
                    studentId: studentId
                }
            },
            include: {
                class: {
                    include: {  // ADD THIS
                        teacher: {
                            include: {  // ADD THIS
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
            }
        });

        if (!enrollment) {
            console.log('❌ Student not enrolled in class');
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied: You are not enrolled in this class' 
            });
        }

        // Check school access AFTER query
        if (!isSuperAdmin && enrollment.class.teacher.user.school !== userSchool) {
            console.log('❌ School mismatch');
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied: School mismatch' 
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
                        // If parsing fails, keep the string content
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

// Save a new note - UPDATED with isSuperAdmin
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

        // Verify enrollment - FIXED QUERY
        const enrollment = await prisma.enrollment.findUnique({
            where: {
                classId_studentId: {
                    classId: classId,
                    studentId: studentId
                }
            },
            include: {
                class: {
                    include: {
                        teacher: {
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
            }
        });

        if (!enrollment) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: You are not enrolled in this class'
            });
        }

        // Check school access AFTER the query
        if (!isSuperAdmin && enrollment.class.teacher.user.school !== userSchool) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: School mismatch'
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
                reloadPage: true // ADD THIS FLAG
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

// Delete a note - UPDATED with isSuperAdmin

const deleteNote = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const noteId = parseInt(req.params.noteId);
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        // Verify the note belongs to the student - FIXED QUERY
        const note = await prisma.studentNote.findFirst({
            where: {
                id: noteId,
                studentId: studentId
            },
            include: {
                class: {
                    include: {  // ADD THIS
                        teacher: {
                            include: {  // ADD THIS
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
            }
        });

        if (!note) {
            return res.status(404).json({
                success: false,
                message: 'Note not found or access denied'
            });
        }

        // Check school access
        if (!isSuperAdmin && note.class.teacher.user.school !== userSchool) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: School mismatch'
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

// Update note - UPDATED with isSuperAdmin
const updateNote = async (req, res) => {
    try {
        const studentId = req.session.user.studentId;
        const noteId = parseInt(req.params.noteId);
        const { title, content } = req.body;
        const userSchool = req.userSchool;
        const isSuperAdmin = req.isSuperAdmin;

        // Verify the note belongs to the student - FIXED QUERY
        const existingNote = await prisma.studentNote.findFirst({
            where: {
                id: noteId,
                studentId: studentId
            },
            include: {
                class: {
                    include: {  // ADD THIS
                        teacher: {
                            include: {  // ADD THIS
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
            }
        });

        if (!existingNote) {
            return res.status(404).json({
                success: false,
                message: 'Note not found or access denied'
            });
        }

        // Check school access
        if (!isSuperAdmin && existingNote.class.teacher.user.school !== userSchool) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: School mismatch'
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

// Download material file - UPDATED with isSuperAdmin
const downloadMaterial = async (req, res) => {
  try {
    const studentId = req.session.user.studentId;
    const materialId = parseInt(req.params.materialId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('📥 Download request for material:', materialId, 'by student:', studentId);

    // Get material with access control - UPDATED QUERY
    const material = await prisma.material.findUnique({
      where: { id: materialId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { 
                studentId: studentId
              }
            },
            ...(isSuperAdmin ? {} : {
              teacher: {
                user: {
                  school: userSchool
                }
              }
            })
          }
        }
      }
    });

    if (!material) {
      console.log('❌ Material not found');
      return res.status(404).render('error/404', { title: 'Material Not Found' });
    }

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
    
    if (!material.fileUrl || !fs.existsSync(material.fileUrl)) {
      console.log('❌ File not found at path:', material.fileUrl);
      return res.status(404).render('error/404', { 
        title: 'File Not Found',
        message: 'The requested file could not be found on the server.'
      });
    }

    // Get proper filename for download
    const filename = path.basename(material.fileUrl);
    const originalFilename = material.title + path.extname(material.fileUrl);
    
    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    console.log('✅ Streaming file:', material.fileUrl);
    
    // Stream the file
    const fileStream = fs.createReadStream(material.fileUrl);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('❌ Download material error:', error);
    res.status(500).render('error/500', { title: 'Download Error' });
  }
};

// Helper function to build school-aware where clauses
const buildSchoolAwareWhere = (userSchool, isSuperAdmin, baseWhere = {}) => {
  if (isSuperAdmin) {
    return baseWhere;
  }
  
  return {
    ...baseWhere,
    OR: [
      {
        teacher: {
          user: {
            school: userSchool
          }
        }
      },
      // Add other school-aware conditions as needed
      ...(baseWhere.OR || [])
    ]
  };
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

    downloadMaterial
};