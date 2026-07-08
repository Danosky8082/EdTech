const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const defaultPassword = process.env.DEFAULT_PASSWORD || '12345';

async function main() {
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);
  
  console.log('🌱 Starting database seeding...');

  // 1. SUPER ADMIN (no school)
  const superAdminUser = await prisma.user.upsert({
    where: { idNumber: 'SUPER001' },
    update: {},
    create: {
      idNumber: 'SUPER001',
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      email: 'super@admin.com',
      role: 'admin',
      school: null,
      isTemporaryPassword: false
    }
  });
  await prisma.admin.upsert({
    where: { userId: superAdminUser.id },
    update: {},
    create: {
      userId: superAdminUser.id,
      roleLevel: 'superadmin'
    }
  });
  console.log('✅ Super Admin created: SUPER001 / 12345');

  // 2. Principal (Greenwood High School)
  const adminUser = await prisma.user.upsert({
    where: { idNumber: 'admin001' },
    update: {},
    create: {
      idNumber: 'admin001',
      password: hashedPassword,
      firstName: 'School',
      lastName: 'Principal',
      email: 'principal@school.edu',
      role: 'admin',
      school: 'Greenwood High School',
      isTemporaryPassword: false
    }
  });
  await prisma.admin.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: {
      userId: adminUser.id,
      roleLevel: 'principal'
    }
  });
  console.log('✅ Principal created: admin001 / 12345');

  // 3. Head Teacher (Greenwood High School)
  const headTeacherUser = await prisma.user.upsert({
    where: { idNumber: 'headteacher001' },
    update: {},
    create: {
      idNumber: 'headteacher001',
      password: hashedPassword,
      firstName: 'Sarah',
      lastName: 'Johnson',
      email: 'sarah.johnson@school.edu',
      role: 'admin',
      school: 'Greenwood High School',
      isTemporaryPassword: false
    }
  });
  await prisma.admin.upsert({
    where: { userId: headTeacherUser.id },
    update: {},
    create: {
      userId: headTeacherUser.id,
      roleLevel: 'headteacher'
    }
  });
  console.log('✅ Head Teacher created: headteacher001 / 12345');

  // 4. Class Teacher (Mr John – Art/Class Teacher)
  const teacherJohn = await prisma.user.upsert({
    where: { idNumber: 'teacher001' },
    update: {},
    create: {
      idNumber: 'teacher001',
      password: hashedPassword,
      firstName: 'John',
      lastName: 'Doe',
      email: 'johndoe@school.edu',
      role: 'teacher',
      school: 'Greenwood High School',
      isTemporaryPassword: false
    }
  });
  const johnTeacher = await prisma.teacher.upsert({
    where: { userId: teacherJohn.id },
    update: {},
    create: {
      userId: teacherJohn.id,
      subject: 'Art'
    }
  });
  console.log('✅ Teacher John (Art) created: teacher001 / 12345');

  // 5. Subject Teachers (same school)
  // Miss Sue – Maths
  const teacherSue = await prisma.user.upsert({
    where: { idNumber: 'teacher002' },
    update: {},
    create: {
      idNumber: 'teacher002',
      password: hashedPassword,
      firstName: 'Sue',
      lastName: 'Matthews',
      email: 'sue@school.edu',
      role: 'teacher',
      school: 'Greenwood High School',
      isTemporaryPassword: false
    }
  });
  const sueTeacher = await prisma.teacher.upsert({
    where: { userId: teacherSue.id },
    update: {},
    create: {
      userId: teacherSue.id,
      subject: 'Mathematics'
    }
  });

  // Mr Ade – English
  const teacherAde = await prisma.user.upsert({
    where: { idNumber: 'teacher003' },
    update: {},
    create: {
      idNumber: 'teacher003',
      password: hashedPassword,
      firstName: 'Ade',
      lastName: 'Okafor',
      email: 'ade@school.edu',
      role: 'teacher',
      school: 'Greenwood High School',
      isTemporaryPassword: false
    }
  });
  const adeTeacher = await prisma.teacher.upsert({
    where: { userId: teacherAde.id },
    update: {},
    create: {
      userId: teacherAde.id,
      subject: 'English'
    }
  });

  // Mrs Ali – Science
  const teacherAli = await prisma.user.upsert({
    where: { idNumber: 'teacher004' },
    update: {},
    create: {
      idNumber: 'teacher004',
      password: hashedPassword,
      firstName: 'Ali',
      lastName: 'Hassan',
      email: 'ali@school.edu',
      role: 'teacher',
      school: 'Greenwood High School',
      isTemporaryPassword: false
    }
  });
  const aliTeacher = await prisma.teacher.upsert({
    where: { userId: teacherAli.id },
    update: {},
    create: {
      userId: teacherAli.id,
      subject: 'Science'
    }
  });

  console.log('✅ Subject teachers created: Sue (Math), Ade (English), Ali (Science)');

  // 6. Create the class: JSS 1 A – with Mr John as class teacher
  const jss1A = await prisma.class.upsert({
    where: {
      grade_section_teacherId_name: {
        grade: 'JSS 1',
        section: 'A',
        teacherId: johnTeacher.id,
        name: 'JSS 1 A'
      }
    },
    update: {},
    create: {
      name: 'JSS 1 A',
      grade: 'JSS 1',
      section: 'A',
      teacherId: johnTeacher.id
    }
  });
  console.log('✅ Class created: JSS 1 A (class teacher: John)');

  // 7. Assign subject teachers via ClassTeacher
  const subjectAssignments = [
    { teacherId: sueTeacher.id, subject: 'Mathematics', role: 'subject' },
    { teacherId: adeTeacher.id, subject: 'English', role: 'subject' },
    { teacherId: aliTeacher.id, subject: 'Science', role: 'subject' }
  ];

  for (const assignment of subjectAssignments) {
    await prisma.classTeacher.upsert({
      where: {
        classId_teacherId_subject: {
          classId: jss1A.id,
          teacherId: assignment.teacherId,
          subject: assignment.subject
        }
      },
      update: {},
      create: {
        classId: jss1A.id,
        teacherId: assignment.teacherId,
        subject: assignment.subject,
        role: assignment.role
      }
    });
  }
  console.log('✅ Subject teachers linked to JSS 1 A');

  // 8. Students (Greenwood High)
  const student1 = await prisma.user.upsert({
    where: { idNumber: 'student001' },
    update: {},
    create: {
      idNumber: 'student001',
      password: hashedPassword,
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@school.edu',
      role: 'student',
      school: 'Greenwood High School',
      isTemporaryPassword: true
    }
  });
  const student1Data = await prisma.student.upsert({
    where: { userId: student1.id },
    update: {},
    create: {
      userId: student1.id,
      grade: 'JSS 1',
      section: 'A',
      tuitionStatus: 'paid',
      canChangePassword: true
    }
  });

  const student2 = await prisma.user.upsert({
    where: { idNumber: 'student002' },
    update: {},
    create: {
      idNumber: 'student002',
      password: hashedPassword,
      firstName: 'Michael',
      lastName: 'Brown',
      email: 'michael@school.edu',
      role: 'student',
      school: 'Greenwood High School',
      isTemporaryPassword: true
    }
  });
  const student2Data = await prisma.student.upsert({
    where: { userId: student2.id },
    update: {},
    create: {
      userId: student2.id,
      grade: 'JSS 1',
      section: 'A',
      tuitionStatus: 'partial',
      canChangePassword: false,
      tempPasswordExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });

  console.log('✅ Students created: Jane (paid), Michael (partial)');

  // 9. Enroll students in the class
  await prisma.enrollment.upsert({
    where: {
      classId_studentId: {
        classId: jss1A.id,
        studentId: student1Data.id
      }
    },
    update: {},
    create: {
      studentId: student1Data.id,
      classId: jss1A.id
    }
  });
  await prisma.enrollment.upsert({
    where: {
      classId_studentId: {
        classId: jss1A.id,
        studentId: student2Data.id
      }
    },
    update: {},
    create: {
      studentId: student2Data.id,
      classId: jss1A.id
    }
  });
  console.log('✅ Students enrolled in JSS 1 A');

  // 10. Tuition payment for Jane (paid)
  await prisma.tuitionPayment.upsert({
    where: { receiptNumber: 'REC001' },
    update: {},
    create: {
      receiptNumber: 'REC001',
      amount: 500.00,
      status: 'verified',
      verifiedBy: superAdminUser.id,
      verifiedAt: new Date(),
      studentId: student1Data.id,
      semester: '2024-1'
    }
  });
  console.log('✅ Tuition payment record created for Jane');

  // 11. Sample material & assignment (optional)
  await prisma.material.upsert({
    where: { id: 'sample-material' }, // Not recommended – better to use a unique field. We'll just create.
    update: {},
    create: {
      id: 'sample-material',
      title: 'Algebra Basics',
      description: 'Introduction to algebraic expressions',
      type: 'textbook',
      fileUrl: '/materials/algebra.pdf',
      category: 'Mathematics',
      tags: ['algebra'],
      classId: jss1A.id,
      teacherId: johnTeacher.id,
      isPublic: true
    }
  });

  await prisma.assignment.upsert({
    where: { id: 'sample-assignment' },
    update: {},
    create: {
      id: 'sample-assignment',
      title: 'Algebra Assignment 1',
      description: 'Solve the equations',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      classId: jss1A.id,
      teacherId: johnTeacher.id,
      points: 100
    }
  });
  console.log('✅ Sample material and assignment created');

  // 12. (Optional) Teacher from another school – Riverview Academy
  const teacherRiverview = await prisma.user.upsert({
    where: { idNumber: 'teacher005' },
    update: {},
    create: {
      idNumber: 'teacher005',
      password: hashedPassword,
      firstName: 'Emily',
      lastName: 'Chen',
      email: 'emily@riverview.edu',
      role: 'teacher',
      school: 'Riverview Academy',
      isTemporaryPassword: false
    }
  });
  await prisma.teacher.upsert({
    where: { userId: teacherRiverview.id },
    update: {},
    create: {
      userId: teacherRiverview.id,
      subject: 'Science'
    }
  });
  console.log('✅ Teacher from Riverview Academy created: teacher005 / 12345');

  // Student at Riverview
  const studentRiverview = await prisma.user.upsert({
    where: { idNumber: 'student003' },
    update: {},
    create: {
      idNumber: 'student003',
      password: hashedPassword,
      firstName: 'Alex',
      lastName: 'Rodriguez',
      email: 'alex@riverview.edu',
      role: 'student',
      school: 'Riverview Academy',
      isTemporaryPassword: true
    }
  });
  await prisma.student.upsert({
    where: { userId: studentRiverview.id },
    update: {},
    create: {
      userId: studentRiverview.id,
      grade: '11',
      section: 'B',
      tuitionStatus: 'unpaid',
      canChangePassword: false
    }
  });
  console.log('✅ Student at Riverview Academy created: student003 / 12345');

  console.log('\n🎉 Seeding completed successfully!');
  console.log('\n📋 Login Credentials:');
  console.log('=====================');
  console.log('🔹 Super Admin:      SUPER001 / 12345');
  console.log('🔹 Principal:        admin001 / 12345');
  console.log('🔹 Head Teacher:     headteacher001 / 12345');
  console.log('🔹 Class Teacher:    teacher001 / 12345 (John – Art)');
  console.log('🔹 Subject Teachers: teacher002 / 12345 (Sue – Maths)');
  console.log('                    teacher003 / 12345 (Ade – English)');
  console.log('                    teacher004 / 12345 (Ali – Science)');
  console.log('🔹 Students:         student001 / 12345 (Jane – paid)');
  console.log('                    student002 / 12345 (Michael – partial)');
  console.log('🔹 Riverview:        teacher005 / 12345 (Emily)');
  console.log('                    student003 / 12345 (Alex – unpaid)');
  console.log('\n🏫 Schools: Greenwood High School, Riverview Academy');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });