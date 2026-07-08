const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const defaultPassword = process.env.DEFAULT_PASSWORD || '12345';

async function main() {
  // Hash default password
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);
  
  console.log('🌱 Starting database seeding...');

  // Create SUPER ADMIN user (no school assigned)
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
      school: null, // Super admin has no school
      isTemporaryPassword: false
    }
  });
  
  // Create super admin record
  await prisma.admin.upsert({
    where: { userId: superAdminUser.id },
    update: {},
    create: {
      userId: superAdminUser.id,
      roleLevel: 'superadmin'
    }
  });

  console.log('✅ Super Admin created: SUPER001 / 12345');

  // Create admin user (with school)
  const adminUser = await prisma.user.upsert({
    where: { idNumber: 'admin001' },
    update: {},
    create: {
      idNumber: 'admin001',
      password: hashedPassword,
      firstName: 'School',
      lastName: 'Principal',
      email: 'principal@green.edu',
      role: 'admin',
      school: 'Green Spring College',
      isTemporaryPassword: false
    }
  });
  
  // Create admin record
  await prisma.admin.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: {
      userId: adminUser.id,
      roleLevel: 'principal'
    }
  });

  console.log('✅ Principal created: admin001 / 12345');

  // Create head teacher
  const headTeacherUser = await prisma.user.upsert({
    where: { idNumber: 'headteacher001' },
    update: {},
    create: {
      idNumber: 'headteacher001',
      password: hashedPassword,
      firstName: 'Sarah',
      lastName: 'Johnson',
      email: 'sarah.johnson@corona.edu',
      role: 'admin',
      school: 'Corona College',
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

  // Create sample teacher
  const teacherUser = await prisma.user.upsert({
    where: { idNumber: 'GSC-TCH-001' },
    update: {},
    create: {
      idNumber: 'gsc-tch-001',
      password: hashedPassword,
      firstName: 'John',
      lastName: 'Casey',
      email: 'john@green.edu',
      role: 'teacher',
      school: 'Green Spring College',
      isTemporaryPassword: false
    }
  });
  
  const teacher = await prisma.teacher.upsert({
    where: { userId: teacherUser.id },
    update: {},
    create: {
      userId: teacherUser.id,
      subject: 'Mathematics'
    }
  });

  console.log('✅ Teacher created: gsc-tch-001 / 12345');

  // Create another teacher from a different school
  const teacherUser2 = await prisma.user.upsert({
    where: { idNumber: 'cor-tch-001' },
    update: {},
    create: {
      idNumber: 'cor-tch-001',
      password: hashedPassword,
      firstName: 'Emily',
      lastName: 'Chen',
      email: 'emily@corona.edu',
      role: 'teacher',
      school: 'Corona College',
      isTemporaryPassword: false
    }
  });
  
  await prisma.teacher.upsert({
    where: { userId: teacherUser2.id },
    update: {},
    create: {
      userId: teacherUser2.id,
      subject: 'Science'
    }
  });

  console.log('✅ Teacher (different school) created: cor-tch-001 / 12345');

  // Create sample class - FIXED: Use create instead of upsert with hardcoded ID
  const mathClass = await prisma.class.create({
    data: {
      name: 'Mathematics 101',
      grade: '10',
      section: 'A',
      teacherId: teacher.id
    }
  });

  // Create sample students for Greenwood High School
  const studentUser1 = await prisma.user.upsert({
    where: { idNumber: 'student001' },
    update: {},
    create: {
      idNumber: 'student001',
      password: hashedPassword,
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'janesmith@school.edu',
      role: 'student',
      school: 'Greenwood High School',
      isTemporaryPassword: true
    }
  });
  
  const student1 = await prisma.student.upsert({
    where: { userId: studentUser1.id },
    update: {},
    create: {
      userId: studentUser1.id,
      grade: '10',
      section: 'A',
      tuitionStatus: 'paid',
      canChangePassword: true
    }
  });

  const studentUser2 = await prisma.user.upsert({
    where: { idNumber: 'student002' },
    update: {},
    create: {
      idNumber: 'student002',
      password: hashedPassword,
      firstName: 'Michael',
      lastName: 'Brown',
      email: 'michael.brown@school.edu',
      role: 'student',
      school: 'Greenwood High School',
      isTemporaryPassword: true
    }
  });
  
  const student2 = await prisma.student.upsert({
    where: { userId: studentUser2.id },
    update: {},
    create: {
      userId: studentUser2.id,
      grade: '10',
      section: 'A',
      tuitionStatus: 'partial',
      canChangePassword: false,
      tempPasswordExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
    }
  });

  // Create sample student for Riverview Academy (different school)
  const studentUser3 = await prisma.user.upsert({
    where: { idNumber: 'student003' },
    update: {},
    create: {
      idNumber: 'student003',
      password: hashedPassword,
      firstName: 'Alex',
      lastName: 'Rodriguez',
      email: 'alex.rodriguez@riverview.edu',
      role: 'student',
      school: 'Riverview Academy',
      isTemporaryPassword: true
    }
  });
  
  const student3 = await prisma.student.upsert({
    where: { userId: studentUser3.id },
    update: {},
    create: {
      userId: studentUser3.id,
      grade: '11',
      section: 'B',
      tuitionStatus: 'unpaid',
      canChangePassword: false
    }
  });

  console.log('✅ Students created for both schools');

  // Enroll students in classes - FIXED: Use create instead of upsert with wrong constraint name
  await prisma.enrollment.create({
    data: {
      studentId: student1.id,
      classId: mathClass.id
    }
  });

  await prisma.enrollment.create({
    data: {
      studentId: student2.id,
      classId: mathClass.id
    }
  });

  // Create tuition payment records
  await prisma.tuitionPayment.create({
    data: {
      receiptNumber: 'REC001',
      amount: 500.00,
      status: 'verified',
      verifiedBy: superAdminUser.id,
      verifiedAt: new Date(),
      studentId: student1.id,
      semester: '2024-1'
    }
  });

  console.log('✅ Enrollment and payment records created');

  // Create sample materials and assignments
  const material = await prisma.material.create({
    data: {
      title: 'Algebra Basics',
      description: 'Introduction to algebraic expressions and equations',
      type: 'textbook',
      fileUrl: '/materials/algebra.pdf',
      category: 'Mathematics',
      tags: ['algebra', 'basics', 'math'],
      classId: mathClass.id,
      teacherId: teacher.id,
      isPublic: true
    }
  });

  const assignment = await prisma.assignment.create({
    data: {
      title: 'Algebra Assignment 1',
      description: 'Solve the algebraic equations',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      classId: mathClass.id,
      teacherId: teacher.id,
      points: 100
    }
  });

  console.log('✅ Sample materials and assignments created');

  console.log('\n🎉 Seed data created successfully!');
  console.log('\n📋 Login Credentials:');
  console.log('=====================');
  console.log('Super Admin:');
  console.log('  ID: SUPER001, Password: 12345 (Full system access - all schools)');
  console.log('\nGreenwood High School:');
  console.log('  Principal: admin001, Password: 12345');
  console.log('  Head Teacher: headteacher001, Password: 12345');
  console.log('  Teacher: teacher001, Password: 12345');
  console.log('  Students: student001 (paid), student002 (partial), Password: 12345');
  console.log('\nRiverview Academy:');
  console.log('  Teacher: teacher002, Password: 12345');
  console.log('  Student: student003 (unpaid), Password: 12345');
  console.log('\n🏫 Schools created:');
  console.log('  - Greenwood High School');
  console.log('  - Riverview Academy');
  console.log('\n💡 Test the school-based access control by logging in as different users!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });