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

// Teacher dashboard - FIXED with isSuperAdmin
const dashboard = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userId = req.session.user.id;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin; // Get this from the middleware
    
    // First, verify the teacher belongs to the school
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

    // Check if teacher belongs to the school
    if (teacher.user.school !== userSchool && !isSuperAdmin) {
      return res.status(403).render('error/403', { 
        title: 'Access Denied',
        message: 'You do not have access to this school' 
      });
    }

    // Now get classes with school filtering
    const classes = await prisma.class.findMany({
      where: {
        teacherId: teacherId,
        ...(isSuperAdmin ? {} : { // Only apply school filter if not super admin
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
      },
      include: {
        enrollments: {
          where: isSuperAdmin ? {} : { // Only apply school filter if not super admin
            student: {
              user: {
                school: userSchool
              }
            }
          },
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

    // Calculate total students
    let totalStudents = 0;
    classes.forEach(cls => {
      totalStudents += cls.enrollments.length;
    });

    // Get pending grading submissions with school filtering
    const pendingGrading = await prisma.submission.findMany({
      where: {
        assignment: {
          teacherId: teacherId,
          ...(isSuperAdmin ? {} : { // Only apply school filter if not super admin
            teacher: {
              user: {
                school: userSchool
              }
            }
          })
        },
        grade: null,
        ...(isSuperAdmin ? {} : { // Only apply school filter if not super admin
          student: {
            user: {
              school: userSchool
            }
          }
        })
      },
      include: {
        assignment: true,
        student: {
          include: {
            user: true
          }
        }
      },
      orderBy: {
        submittedAt: 'desc'
      },
      take: 5
    });

    // Generate notifications for pending grading
    if (pendingGrading.length > 0) {
      await createNotification(
        userId,
        'Submissions Need Grading',
        `You have ${pendingGrading.length} submission${pendingGrading.length !== 1 ? 's' : ''} waiting to be graded`,
        'fa-check-circle'
      );
    }

    // Generate notifications for upcoming assignment deadlines with school filtering
    const upcomingAssignmentDeadlines = await prisma.assignment.findMany({
      where: {
        teacherId: teacherId,
        dueDate: {
          gt: new Date(),
          lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        },
        ...(isSuperAdmin ? {} : { // Only apply school filter if not super admin
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
        class: true
      },
      orderBy: {
        dueDate: 'asc'
      },
      take: 5
    });

    for (const assignment of upcomingAssignmentDeadlines) {
      const daysUntilDue = Math.ceil((assignment.dueDate - new Date()) / (1000 * 60 * 60 * 24));
      
      await createNotification(
        userId,
        'Assignment Deadline Approaching',
        `${assignment.title} is due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''} for ${assignment.class.name}`,
        'fa-tasks'
      );
    }

    // Generate notifications for recently submitted assignments with school filtering
    const recentSubmissions = await prisma.submission.findMany({
      where: {
        assignment: {
          teacherId: teacherId,
          ...(isSuperAdmin ? {} : { // Only apply school filter if not super admin
            teacher: {
              user: {
                school: userSchool
              }
            }
          })
        },
        submittedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        },
        ...(isSuperAdmin ? {} : { // Only apply school filter if not super admin
          student: {
            user: {
              school: userSchool
            }
          }
        })
      },
      include: {
        assignment: true,
        student: {
          include: {
            user: true
          }
        }
      },
      orderBy: {
        submittedAt: 'desc'
      },
      take: 5
    });

    if (recentSubmissions.length > 0) {
      await createNotification(
        userId,
        'New Submissions',
        `${recentSubmissions.length} new assignment submission${recentSubmissions.length !== 1 ? 's' : ''} in the last 24 hours`,
        'fa-file-upload'
      );
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

    res.render('teacher/dashboard', {
      title: 'Teacher Dashboard',
      user: teacher.user,
      classes: classes,
      pendingGrading,
      totalStudents,
      notifications: formattedNotifications,
      notificationCount,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS LINE
    });
  } catch (error) {
    console.error('Teacher dashboard error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Create assignment
const createAssignment = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const { title, description, dueDate, classId } = req.body;
    
    // Validate required fields
    if (!title || !dueDate || !classId) {
      return res.status(400).render('error/400', { title: 'Bad Request' });
    }
    
    await prisma.assignment.create({
      data: {
        title,
        description,
        dueDate: new Date(dueDate),
        classId: parseInt(classId),
        teacherId
      }
    });

    // Redirect to assignments page after creation
    res.redirect('/teacher/assignments');
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Update assignment
const updateAssignment = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const assignmentId = parseInt(req.params.id);
    const { title, description, dueDate, classId } = req.body;
    
    console.log('📝 Updating assignment:', { 
      assignmentId, 
      title, 
      dueDate, 
      classId,
      teacherId 
    });

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Assignment title is required' 
      });
    }

    if (!dueDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'Due date is required' 
      });
    }

    if (!classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class selection is required' 
      });
    }
    
    // Check if assignment exists and belongs to teacher
    const existingAssignment = await prisma.assignment.findUnique({
      where: { 
        id: assignmentId
      },
      include: {
        class: true
      }
    });

    if (!existingAssignment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Assignment not found' 
      });
    }

    if (existingAssignment.teacherId !== teacherId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied: You can only edit your own assignments' 
      });
    }

    // Verify the class exists and belongs to the teacher
    const classExists = await prisma.class.findFirst({
      where: {
        id: parseInt(classId),
        teacherId: teacherId
      }
    });

    if (!classExists) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid class selection' 
      });
    }

    // Update the assignment - REMOVE updatedAt since it's managed by Prisma
    const updateData = {
      title: title.trim(),
      description: description ? description.trim() : null,
      dueDate: new Date(dueDate),
      // Remove this line: updatedAt: new Date(),
      class: {
        connect: { id: parseInt(classId) }
      }
    };

    const updatedAssignment = await prisma.assignment.update({
      where: { id: assignmentId },
      data: updateData,
      include: {
        class: true
      }
    });

    console.log('✅ Assignment updated successfully:', updatedAssignment.id);

    res.json({ 
      success: true, 
      message: 'Assignment updated successfully',
      assignment: updatedAssignment
    });
  } catch (error) {
    console.error('❌ Update assignment error:', error);
    
    // Handle specific Prisma errors
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Assignment not found' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update assignment',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Grade assignment
const gradeAssignment = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { grade, feedback } = req.body;
    
    // Validate required fields
    if (!grade) {
      return res.status(400).render('error/400', { title: 'Bad Request' });
    }
    
    await prisma.submission.update({
      where: { id: parseInt(submissionId) },
      data: {
        grade: parseFloat(grade),
        feedback
      }
    });

    // Redirect to grading page after grading
    res.redirect('/teacher/grading');
  } catch (error) {
    console.error('Grade assignment error:', error);
    if (error.code === 'P2025') {
      res.status(404).render('error/404', { title: 'Submission Not Found' });
    } else {
      res.status(500).render('error/500', { title: 'Server Error' });
    }
  }
};

// Create exam - ENHANCED VERSION with body validation
const createExam = async (req, res) => {
  try {
    console.log('🔔 Create exam request received');
    
    // Check if req.body exists
    if (!req.body || Object.keys(req.body).length === 0) {
      console.log('❌ req.body is undefined or empty');
      console.log('Request headers:', req.headers);
      req.session.error = 'Form data was not received. Please check if the form is configured correctly.';
      return res.redirect('/teacher/exams');
    }

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

    // Validate required fields with safe access
    if (!title || !title.trim()) {
      req.session.error = 'Exam title is required.';
      return res.redirect('/teacher/exams');
    }

    if (!duration || isNaN(duration)) {
      req.session.error = 'Valid duration is required.';
      return res.redirect('/teacher/exams');
    }

    if (!date) {
      req.session.error = 'Exam date and time is required.';
      return res.redirect('/teacher/exams');
    }

    if (!classId) {
      req.session.error = 'Please select a class.';
      return res.redirect('/teacher/exams');
    }

    // Validate questions
    if (!questions) {
      console.log('❌ No questions provided');
      req.session.error = 'Questions are required. Please add at least one question.';
      return res.redirect('/teacher/exams');
    }

    let parsedQuestions;
    try {
      parsedQuestions = typeof questions === 'string' ? JSON.parse(questions) : questions;
      console.log('✅ Parsed questions:', parsedQuestions.length);
    } catch (parseError) {
      console.log('❌ Error parsing questions:', parseError);
      req.session.error = 'Invalid questions format. Must be valid JSON.';
      return res.redirect('/teacher/exams');
    }

    // Validate parsed questions
    if (!Array.isArray(parsedQuestions) || parsedQuestions.length === 0) {
      console.log('❌ Invalid questions array');
      req.session.error = 'Questions must be a non-empty array.';
      return res.redirect('/teacher/exams');
    }

    // Validate each question
    for (let i = 0; i < parsedQuestions.length; i++) {
      const q = parsedQuestions[i];
      if (!q.question || !q.type || q.correctAnswer === undefined) {
        console.log(`❌ Invalid question at index ${i}:`, q);
        req.session.error = `Question ${i + 1} is missing required fields (question text, type, or correct answer).`;
        return res.redirect('/teacher/exams');
      }
      
      // Ensure each question has points/marks
      if (!q.points && !q.marks) {
        q.points = 1; // Default points
      } else if (q.marks && !q.points) {
        q.points = q.marks; // Use marks as points if points not provided
      }
    }

    // Calculate total marks from questions if not provided
    const calculatedTotalMarks = parsedQuestions.reduce((total, q) => total + (q.points || q.marks || 1), 0);
    
    // Create exam in database with new fields
    console.log('📝 Creating exam in database...');
    const exam = await prisma.exam.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        duration: parseInt(duration),
        date: new Date(date),
        classId: parseInt(classId),
        teacherId: teacherId,
        questions: parsedQuestions,
        maxAttempts: maxAttempts ? parseInt(maxAttempts) : 1,
        showResults: showResults === 'true' || showResults === true,
        totalMarks: totalMarks ? parseInt(totalMarks) : calculatedTotalMarks,
        isActive: true
      }
    });

    console.log('✅ Exam created successfully with ID:', exam.id);

    // Create notifications for students
    try {
      const enrollments = await prisma.enrollment.findMany({
        where: { classId: parseInt(classId) },
        include: {
          student: {
            include: { user: true }
          }
        }
      });

      for (const enrollment of enrollments) {
        await createNotification(
          enrollment.student.user.id,
          'New Exam Scheduled',
          `New exam: "${title}" on ${new Date(date).toLocaleDateString()} for ${duration} minutes.`,
          'fa-clock'
        );
      }
      console.log(`📢 Created notifications for ${enrollments.length} students`);
    } catch (notificationError) {
      console.error('Notification error (non-critical):', notificationError);
    }

    req.session.success = 'Exam created successfully!';
    res.redirect('/teacher/exams');

  } catch (error) {
    console.error('❌ Create exam error:', error);
    
    // Handle specific Prisma errors
    if (error.code === 'P2003') {
      req.session.error = 'Invalid class ID. Please select a valid class.';
    } else if (error.code === 'P2002') {
      req.session.error = 'An exam with similar details already exists.';
    } else {
      req.session.error = 'Failed to create exam. Please try again.';
    }
    
    res.redirect('/teacher/exams');
  }
};

// Upload material
const uploadMaterial = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userId = req.session.user.id;
    const { title, description, classId, type, category, isPublic } = req.body;
    
    if (!req.file) {
      return res.status(400).render('error/400', { title: 'No File Uploaded' });
    }

    if (!title || !type) {
      return res.status(400).render('error/400', { title: 'Bad Request' });
    }
    
    // Convert checkbox value to boolean properly
    const isPublicBool = isPublic === 'on';
    
    // Create the material
    const material = await prisma.material.create({
      data: {
        title,
        description,
        type,
        category,
        fileUrl: req.file.path,
        classId: classId ? parseInt(classId) : null,
        teacherId,
        isPublic: isPublicBool
      },
      include: {
        class: {
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

    // ✅ CREATE NOTIFICATIONS FOR STUDENTS
    if (classId && !isPublicBool) {
      // Material is for a specific class (not public)
      try {
        // Get all students enrolled in this class
        const enrollments = await prisma.enrollment.findMany({
          where: { classId: parseInt(classId) },
          include: {
            student: {
              include: {
                user: true
              }
            }
          }
        });

        // Create notifications for each student
        for (const enrollment of enrollments) {
          await createNotification(
            enrollment.student.user.id, // Student's user ID
            'New Study Material Available',
            `Your teacher has uploaded new material: "${title}" for ${material.class.name} class.`,
            getMaterialIcon(type)
          );
        }

        console.log(`Created notifications for ${enrollments.length} students in class ${classId}`);
      } catch (notificationError) {
        console.error('Error creating notifications:', notificationError);
        // Don't fail the upload if notifications fail
      }
    } else if (isPublicBool) {
      // Material is public - notify all students of this teacher
      try {
        // Get all classes taught by this teacher
        const teacherClasses = await prisma.class.findMany({
          where: { teacherId },
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
        });

        // Get all unique students from all classes
        const allStudents = new Set();
        teacherClasses.forEach(cls => {
          cls.enrollments.forEach(enrollment => {
            allStudents.add(enrollment.student.user.id);
          });
        });

        // Create notifications for each student
        for (const studentUserId of allStudents) {
          await createNotification(
            studentUserId,
            'New Public Material Available',
            `Your teacher has uploaded new public material: "${title}".`,
            getMaterialIcon(type)
          );
        }

        console.log(`Created notifications for ${allStudents.size} students for public material`);
      } catch (notificationError) {
        console.error('Error creating public material notifications:', notificationError);
      }
    }

    res.redirect('/teacher/materials?success=Material uploaded successfully');
  } catch (error) {
    console.error('Upload material error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
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

// Get assignments for assignments page - UPDATED with isSuperAdmin
const getAssignments = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const assignments = await prisma.assignment.findMany({
      where: { 
        teacherId: teacherId,
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
        class: {
          include: {
            teacher: {
              include: {
                user: true
              }
            }
          }
        },
        submissions: {
          where: isSuperAdmin ? {} : {
            student: {
              user: {
                school: userSchool
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const classes = await prisma.class.findMany({
      where: { 
        teacherId: teacherId,
        ...(isSuperAdmin ? {} : {
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
      }
    });

    res.render('teacher/assignments', {
      title: 'Assignments',
      assignments,
      classes,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get materials for materials page - UPDATED with isSuperAdmin
const getMaterials = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const materials = await prisma.material.findMany({
      where: { 
        teacherId: teacherId,
        ...(isSuperAdmin ? {} : {
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
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
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const classes = await prisma.class.findMany({
      where: { 
        teacherId: teacherId,
        ...(isSuperAdmin ? {} : {
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
      }
    });

    res.render('teacher/materials', {
      title: 'Materials',
      materials,
      classes,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get materials error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get submissions for grading page - UPDATED with school filtering and isSuperAdmin
const getGrading = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const submissions = await prisma.submission.findMany({
      where: {
        assignment: {
          teacherId: teacherId,
          ...(isSuperAdmin ? {} : {
            teacher: {
              user: {
                school: userSchool
              }
            }
          })
        },
        ...(isSuperAdmin ? {} : {
          student: {
            user: {
              school: userSchool
            }
          }
        })
      },
      include: {
        assignment: {
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

    res.render('teacher/grading', {
      title: 'Grading',
      submissions,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get grading error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get exams for exams page - UPDATED with school filtering and isSuperAdmin
const getExams = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    console.log('📋 Fetching exams for teacher:', teacherId, 'School:', userSchool);
    
    const exams = await prisma.exam.findMany({
      where: { 
        teacherId: teacherId,
        ...(isSuperAdmin ? {} : {
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
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
        },
        _count: {
          select: {
            attempts: {
              where: isSuperAdmin ? {} : {
                student: {
                  user: {
                    school: userSchool
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

    console.log('✅ Found exams:', exams.length);

    const upcomingExams = exams.filter(exam => new Date(exam.date) > new Date() && exam.isActive);
    const recentExams = exams.filter(exam => new Date(exam.date) <= new Date()).slice(0, 5);

    const classes = await prisma.class.findMany({
      where: { 
        teacherId: teacherId,
        ...(isSuperAdmin ? {} : {
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
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
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('❌ Get exams error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get classes for classes page - UPDATED with isSuperAdmin
const getClasses = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // First verify teacher belongs to school
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: { user: true }
    });

    if (!teacher || (teacher.user.school !== userSchool && !isSuperAdmin)) {
      return res.status(403).render('error/403', { 
        title: 'Access Denied',
        message: 'You do not have access to this school' 
      });
    }

    // Get classes with school filtering
    const classes = await prisma.class.findMany({
      where: { 
        teacherId: teacherId,
        ...(isSuperAdmin ? {} : {
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
      },
      include: {
        enrollments: {
          where: isSuperAdmin ? {} : {
            student: {
              user: {
                school: userSchool
              }
            }
          },
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
      }
    });

    res.render('teacher/classes', {
      title: 'My Classes',
      classes: classes,
      teacher: teacher,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get students for students management page - UPDATED with isSuperAdmin
const getStudents = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // First verify teacher belongs to school
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: { user: true }
    });

    if (!teacher || (teacher.user.school !== userSchool && !isSuperAdmin)) {
      return res.status(403).render('error/403', { 
        title: 'Access Denied',
        message: 'You do not have access to this school' 
      });
    }

    // Get teacher's classes with enrollments and students
    const classes = await prisma.class.findMany({
      where: { 
        teacherId: teacherId,
        ...(isSuperAdmin ? {} : {
          teacher: {
            user: {
              school: userSchool
            }
          }
        })
      },
      include: {
        enrollments: {
          where: isSuperAdmin ? {} : {
            student: {
              user: {
                school: userSchool
              }
            }
          },
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

    // Get counts for statistics with school filtering
    const assignmentsCount = await prisma.assignment.count({
      where: { 
        teacherId: teacherId,
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
    });

    const examsCount = await prisma.exam.count({
      where: { 
        teacherId: teacherId,
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
    });

    res.render('teacher/students', {
      title: 'Student Management',
      students: allStudents,
      classes: classes,
      assignmentsCount,
      examsCount,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get specific class by ID
const getClassById = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const classId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const classData = await prisma.class.findUnique({
      where: { 
        id: classId,
        teacherId: teacherId
      },
      include: {
        enrollments: {
          include: {
            student: {
              include: { user: true }
                }
              }
            },
            assignments: {
              orderBy: { createdAt: 'desc' }
            },
            materials: {
              orderBy: { createdAt: 'desc' }
            },
            exams: {
              orderBy: { date: 'desc' }
            }
          }
        });

    if (!classData) {
      return res.status(404).render('error/404', { title: 'Class Not Found' });
    }

    // Use the new class-view template
    res.render('teacher/class-view', {
      title: `Class: ${classData.name}`,
      currentClass: classData,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
    
  } catch (error) {
    console.error('Get class by ID error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get specific assignment by ID
const getAssignmentById = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const assignmentId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const assignment = await prisma.assignment.findUnique({
      where: { 
        id: assignmentId,
        teacherId: teacherId
      },
      include: {
        class: true,
        submissions: {
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

    if (!assignment) {
      return res.status(404).render('error/404', { title: 'Assignment Not Found' });
    }

    // ✅ ADD THIS: Get teacher's classes for the dropdown
    const classes = await prisma.class.findMany({
      where: { teacherId }
    });

    res.render('teacher/assignment-view', {
      title: `Assignment: ${assignment.title}`,
      assignment: assignment,
      classes: classes, // ✅ ADD THIS LINE
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get assignment error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Delete assignment
const deleteAssignment = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const assignmentId = parseInt(req.params.id);
    
    console.log('Deleting assignment:', assignmentId, 'for teacher:', teacherId);
    
    // Check if assignment exists and belongs to this teacher
    const assignment = await prisma.assignment.findUnique({
      where: { 
        id: assignmentId
      }
    });

    if (!assignment) {
      console.log('Assignment not found');
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    // Verify the assignment belongs to the current teacher
    if (assignment.teacherId !== teacherId) {
      console.log('Unauthorized: Teacher ID mismatch');
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this assignment' });
    }

    // Delete the assignment
    await prisma.assignment.delete({
      where: { id: assignmentId }
    });

    console.log('Assignment deleted successfully');
    res.json({ success: true, message: 'Assignment deleted successfully' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete assignment' });
  }
};

// Get students for a specific class
const getClassStudents = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const classId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    // Get the specific class with its students
    const classData = await prisma.class.findUnique({
      where: { 
        id: classId,
        teacherId: teacherId
      },
      include: {
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

    res.render('teacher/class-students', {
      title: `Students - ${classData.name}`,
      class: classData,
      students: classData.enrollments.map(enrollment => enrollment.student),
      user: req.session.user,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get class students error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get specific submission for grading
const getGradingItemById = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const submissionId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const submission = await prisma.submission.findUnique({
      where: { 
        id: submissionId
      },
      include: {
        assignment: {
          include: {
            class: true,
            teacher: {
              include: { user: true }
            }
          }
        },
        student: {
          include: { user: true }
        }
      }
    });

    // Check if the submission belongs to the teacher
    if (!submission || submission.assignment.teacherId !== teacherId) {
      return res.status(404).render('error/404', { title: 'Submission Not Found' });
    }

    res.render('teacher/grading-item', {
      title: `Grade Submission - ${submission.assignment.title}`,
      submission: submission,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get grading item error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Delete material
const deleteMaterial = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const materialId = parseInt(req.params.id);
    
    // Check if material exists and belongs to this teacher
    const material = await prisma.material.findUnique({
      where: { 
        id: materialId
      }
    });

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    if (material.teacherId !== teacherId) {
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this material' });
    }

    // Delete the material
    await prisma.material.delete({
      where: { id: materialId }
    });

    res.json({ success: true, message: 'Material deleted successfully' });
  } catch (error) {
    console.error('Delete material error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete material' });
  }
};


// Get specific exam by ID
const getExamById = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const examId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const exam = await prisma.exam.findUnique({
      where: { 
        id: examId,
        teacherId: teacherId  // Ensure teacher owns this exam
      },
      include: {
        class: true,
        // Include other relations as needed (questions, attempts, etc.)
      }
    });

    if (!exam) {
      return res.status(404).render('error/404', { title: 'Exam Not Found' });
    }

    res.render('teacher/exam-view', {
      title: `Exam: ${exam.title}`,
      exam: exam,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get exam by ID error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get exam edit page
const getExamEdit = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const examId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const exam = await prisma.exam.findUnique({
      where: { 
        id: examId,
        teacherId: teacherId
      },
      include: {
        class: true
      }
    });

    if (!exam) {
      return res.status(404).render('error/404', { title: 'Exam Not Found' });
    }

    // Ensure questions is always an array
    if (exam.questions && typeof exam.questions === 'string') {
      try {
        exam.questions = JSON.parse(exam.questions);
      } catch (error) {
        console.error('Error parsing exam questions:', error);
        exam.questions = [];
      }
    } else if (!exam.questions) {
      exam.questions = [];
    }

    // Get teacher's classes for the dropdown
    const classes = await prisma.class.findMany({
      where: { teacherId }
    });

    res.render('teacher/exam-edit', {
      title: `Edit Exam: ${exam.title}`,
      exam: exam,
      classes: classes,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get exam edit error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Get exam results
const getExamResults = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const examId = parseInt(req.params.id);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;
    
    const exam = await prisma.exam.findUnique({
      where: { 
        id: examId,
        teacherId: teacherId
      },
      include: {
        class: {
          include: {
            enrollments: {
              include: {
                student: {
                  include: { user: true }
                }
              }
            }
          }
        },
        attempts: {
          include: {
            student: {
              include: { user: true }
            }
          }
        }
      }
    });

    if (!exam) {
      return res.status(404).render('error/404', { title: 'Exam Not Found' });
    }

    res.render('teacher/exam-results', {
      title: `Results: ${exam.title}`,
      exam: exam,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Get exam results error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Update exam - ENHANCED VERSION
const updateExam = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const examId = parseInt(req.params.id);
    const { 
      title, 
      description, 
      date, 
      duration, 
      classId, 
      questions,
      maxAttempts,
      showResults,
      totalMarks,
      isActive
    } = req.body;
    
    // Validate required fields
    if (!title || !date || !duration || !classId) {
      req.session.error = 'All required fields must be filled';
      return res.redirect(`/teacher/exam/${examId}/edit`);
    }
    
    // Check if exam exists and belongs to teacher
    const existingExam = await prisma.exam.findUnique({
      where: { 
        id: examId,
        teacherId: teacherId
      }
    });

    if (!existingExam) {
      return res.status(404).render('error/404', { title: 'Exam Not Found' });
    }

    // Parse questions JSON if provided
    let questionsData = existingExam.questions;
    let calculatedTotalMarks = existingExam.totalMarks;

    if (questions && questions.trim() !== '') {
      try {
        questionsData = JSON.parse(questions);
        
        // Validate questions array
        if (!Array.isArray(questionsData)) {
          questionsData = existingExam.questions;
        } else {
          // Calculate total marks from questions
          calculatedTotalMarks = questionsData.reduce((total, q) => total + (q.points || q.marks || 1), 0);
        }
      } catch (parseError) {
        console.error('Error parsing questions JSON:', parseError);
        questionsData = existingExam.questions;
      }
    }
    
    // Update the exam with new fields
    await prisma.exam.update({
      where: { id: examId },
      data: {
        title,
        description,
        date: new Date(date),
        duration: parseInt(duration),
        classId: parseInt(classId),
        questions: questionsData,
        maxAttempts: maxAttempts ? parseInt(maxAttempts) : existingExam.maxAttempts,
        showResults: showResults === 'true' || showResults === true,
        totalMarks: totalMarks ? parseInt(totalMarks) : calculatedTotalMarks,
        isActive: isActive === 'true' || isActive === true
      }
    });

    res.redirect('/teacher/exams?success=Exam updated successfully');
  } catch (error) {
    console.error('Update exam error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// View exams that need grading
const viewExamsForGrading = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const exams = await prisma.exam.findMany({
      where: {
        teacherId: teacherId,
        attempts: {
          some: {
            status: 'submitted'
          }
        }
      },
      include: {
        class: true,
        attempts: {
          where: {
            status: 'submitted'
          },
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
            attempts: {
              where: {
                status: 'submitted'
              }
            }
          }
        }
      }
    });

    res.render('teacher/exams-for-grading', {
      title: 'Exams for Grading',
      exams: exams,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('View exams for grading error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Grade specific exam attempt
const gradeExamAttempt = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const attemptId = parseInt(req.params.attemptId);
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            class: true,
            teacher: {
              include: {
                user: true
              }
            }
          }
        },
        student: {
          include: {
            user: true
          }
        }
      }
    });

    if (!attempt || attempt.exam.teacherId !== teacherId) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    res.render('teacher/grade-exam', {
      title: `Grade Exam - ${attempt.exam.title}`,
      attempt: attempt,
      exam: attempt.exam,
      userSchool: userSchool,
      isSuperAdmin: isSuperAdmin // ADD THIS
    });
  } catch (error) {
    console.error('Grade exam attempt error:', error);
    res.status(500).render('error/500', { title: 'Server Error' });
  }
};

// Submit grading
const submitGrading = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const attemptId = parseInt(req.params.attemptId);
    const { scores, feedback, totalScore } = req.body;

    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
        student: {
          include: {
            user: true
          }
        }
      }
    });

    if (!attempt || attempt.exam.teacherId !== teacherId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update attempt with teacher's grading
    await prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        score: parseFloat(totalScore),
        teacherFeedback: feedback,
        status: 'graded',
        gradedAt: new Date(),
        gradedBy: teacherId
      }
    });

    // ✅ CREATE NOTIFICATION FOR STUDENT WHEN GRADED
    await createNotification(
      attempt.student.user.id,
      'Exam Graded',
      `Your exam "${attempt.exam.title}" has been graded. Results will be available once published.`,
      'fa-check-circle'
    );

    res.json({ 
      success: true, 
      message: 'Exam graded successfully!',
      attemptId: attemptId
    });
  } catch (error) {
    console.error('Submit grading error:', error);
    res.status(500).json({ error: 'Failed to submit grading' });
  }
};

// Publish results to students
const publishResults = async (req, res) => {
  try {
    const teacherId = req.session.user.teacherId;
    const examId = parseInt(req.params.examId);

    const exam = await prisma.exam.findUnique({
      where: { id: examId }
    });

    if (!exam || exam.teacherId !== teacherId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all graded attempts that will be published
    const gradedAttempts = await prisma.examAttempt.findMany({
      where: {
        examId: examId,
        status: 'graded'
      },
      include: {
        student: {
          include: {
            user: true
          }
        }
      }
    });

    // Update all graded attempts to "published" status so students can see them
    await prisma.examAttempt.updateMany({
      where: {
        examId: examId,
        status: 'graded'
      },
      data: {
        status: 'published'
      }
    });

    // ✅ CREATE NOTIFICATIONS FOR STUDENTS
    for (const attempt of gradedAttempts) {
      await createNotification(
        attempt.student.user.id, // Student's user ID
        'Exam Results Published',
        `Your results for "${exam.title}" have been published. Check your exam results!`,
        'fa-chart-bar'
      );
    }

    res.json({ 
      success: true, 
      message: 'Results published to students successfully!',
      notifiedStudents: gradedAttempts.length
    });
  } catch (error) {
    console.error('Publish results error:', error);
    res.status(500).json({ error: 'Failed to publish results' });
  }
};

// Upload exam questions from file (CSV or JSON)
const uploadExamQuestions = async (req, res) => {
  try {
    console.log('Upload questions request received');
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }

    const filePath = req.file.path;
    const fileExtension = req.file.originalname.split('.').pop().toLowerCase();
    
    console.log('Processing file:', req.file.originalname, 'Type:', fileExtension);
    
    let questions = [];

    if (fileExtension === 'csv') {
      questions = await parseCSVFile(filePath);
    } else if (fileExtension === 'json') {
      questions = await parseJSONFile(filePath);
    } else {
      return res.status(400).json({ 
        success: false, 
        error: 'Unsupported file format. Please upload CSV or JSON.' 
      });
    }

    // Validate questions structure
    const validatedQuestions = validateQuestions(questions);
    
    if (validatedQuestions.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No valid questions found in the file. Please check the file format.' 
      });
    }

    console.log('Successfully processed', validatedQuestions.length, 'questions');

    res.json({
      success: true,
      questions: validatedQuestions,
      message: `Successfully imported ${validatedQuestions.length} questions.`
    });

  } catch (error) {
    console.error('Upload exam questions error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process questions file: ' + error.message 
    });
  }
};

// Helper function to parse CSV file
const parseCSVFile = async (filePath) => {
  const fs = require('fs');
  const csv = require('csv-parser');
  
  return new Promise((resolve, reject) => {
    const questions = [];
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        try {
          // Skip empty rows
          if (!row.question || row.question.trim() === '') {
            return;
          }

          const question = {
            type: (row.type || 'multiple_choice').toLowerCase(),
            question: row.question.trim(),
            marks: parseInt(row.marks) || 1,
            correctAnswer: row.correctAnswer
          };

          // Parse options for multiple choice
          if (question.type === 'multiple_choice') {
            question.options = [];
            for (let i = 1; i <= 6; i++) {
              const optionKey = `option${i}`;
              if (row[optionKey] && row[optionKey].trim() !== '') {
                question.options.push(row[optionKey].trim());
              }
            }
            
            // Convert correctAnswer to index if it's a number
            if (question.correctAnswer && !isNaN(question.correctAnswer)) {
              question.correctAnswer = parseInt(question.correctAnswer);
            }
          }

          questions.push(question);
        } catch (error) {
          console.error('Error parsing CSV row:', error, 'Row:', row);
        }
      })
      .on('end', () => {
        resolve(questions);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
};

// Helper function to parse JSON file
const parseJSONFile = async (filePath) => {
  const fs = require('fs').promises;
  
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const questions = JSON.parse(data);
    
    if (!Array.isArray(questions)) {
      throw new Error('JSON file should contain an array of questions');
    }
    
    return questions;
  } catch (error) {
    throw new Error(`Invalid JSON format: ${error.message}`);
  }
};

// Helper function to validate questions structure
const validateQuestions = (questions) => {
  const validQuestions = [];
  
  questions.forEach((q, index) => {
    try {
      // Basic validation
      if (!q.question || q.question.trim() === '') {
        console.warn(`Skipping question ${index + 1}: Missing question text`);
        return;
      }

      const question = {
        type: q.type || 'multiple_choice',
        question: q.question.trim(),
        marks: parseInt(q.marks) || 1
      };

      // Type-specific validation
      switch (question.type) {
        case 'multiple_choice':
          if (!Array.isArray(q.options) || q.options.length < 2) {
            console.warn(`Skipping question ${index + 1}: Multiple choice needs at least 2 options`);
            return;
          }
          if (q.correctAnswer === undefined || q.correctAnswer === null) {
            console.warn(`Skipping question ${index + 1}: Missing correct answer`);
            return;
          }
          question.options = q.options.filter(opt => opt && opt.trim() !== '');
          question.correctAnswer = parseInt(q.correctAnswer);
          break;

        case 'true_false':
          if (q.correctAnswer === undefined || q.correctAnswer === null) {
            console.warn(`Skipping question ${index + 1}: Missing correct answer`);
            return;
          }
          question.correctAnswer = q.correctAnswer === 'true' || q.correctAnswer === true;
          break;

        case 'short_answer':
          if (!q.correctAnswer || q.correctAnswer.trim() === '') {
            console.warn(`Skipping question ${index + 1}: Missing correct answer`);
            return;
          }
          question.correctAnswer = q.correctAnswer.toString().trim();
          break;

        default:
          console.warn(`Skipping question ${index + 1}: Unknown question type "${question.type}"`);
          return;
      }

      validQuestions.push(question);
    } catch (error) {
      console.warn(`Skipping question ${index + 1}: ${error.message}`);
    }
  });

  return validQuestions;
};

// Download material file
const downloadMaterial = async (req, res) => {
  try {
    const materialId = parseInt(req.params.materialId);
    const userId = req.session.user.id;
    
    // Get material with access control
    const material = await prisma.material.findUnique({
      where: { id: materialId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { 
                student: { 
                  userId: userId 
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

    if (!material) {
      return res.status(404).render('error/404', { title: 'Material Not Found' });
    }

    // Check access: either public material, or student is enrolled in the class, or teacher owns the material
    let hasAccess = false;
    
    if (req.session.user.role === 'student') {
      hasAccess = material.isPublic || 
                 (material.class && material.class.enrollments.length > 0) ||
                 (material.teacher && material.teacher.userId === userId);
    } else if (req.session.user.role === 'teacher') {
      hasAccess = material.teacher && material.teacher.userId === userId;
    }

    if (!hasAccess) {
      return res.status(403).render('error/403', { title: 'Access Denied' });
    }

    // Check if file exists
    const fs = require('fs');
    const path = require('path');
    
    if (!material.fileUrl || !fs.existsSync(material.fileUrl)) {
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
    
    // Stream the file
    const fileStream = fs.createReadStream(material.fileUrl);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Download material error:', error);
    res.status(500).render('error/500', { title: 'Download Error' });
  }
};

// Export all functions
module.exports = {
  dashboard,
  createAssignment,
  updateAssignment, // NEW: Added update assignment function
  gradeAssignment,
  createExam,
  updateExam,
  uploadMaterial,
  getAssignments,
  getMaterials,
  getGrading,
  getExams,
  getClasses,
  getStudents,
  getClassById,
  getAssignmentById,
  getClassStudents,
  getGradingItemById,
  deleteAssignment,
  deleteMaterial,
  getExamById,
  getExamEdit,
  getExamResults,
  viewExamsForGrading,
  gradeExamAttempt,
  submitGrading,
  publishResults,
  uploadExamQuestions,
  downloadMaterial
};