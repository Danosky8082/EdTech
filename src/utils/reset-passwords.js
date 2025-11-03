const prisma = require('./config/database');
const { hashPassword } = require('./utils/passwordUtils');

async function resetPasswords() {
  try {
    console.log('🔧 Resetting passwords to "12345"...');
    
    // Reset specific users to password "12345"
    const usersToReset = ['pr1234', 'student008', 'dan123'];
    
    for (const idNumber of usersToReset) {
      const user = await prisma.user.findUnique({
        where: { idNumber }
      });
      
      if (user) {
        const hashedPassword = await hashPassword('12345');
        await prisma.user.update({
          where: { id: user.id },
          data: { 
            password: hashedPassword,
            isTemporaryPassword: false 
          }
        });
        console.log(`✅ Reset password for ${idNumber} to "12345"`);
      } else {
        console.log(`❌ User ${idNumber} not found`);
      }
    }
    
    // Create test user if doesn't exist
    const testUser = await prisma.user.findUnique({
      where: { idNumber: 'TEST001' }
    });
    
    if (!testUser) {
      const hashedPassword = await hashPassword('test123');
      await prisma.user.create({
        data: {
          idNumber: 'TEST001',
          password: hashedPassword,
          firstName: 'Test',
          lastName: 'User',
          role: 'student',
          isActive: true,
          school: 'Test School',
          isTemporaryPassword: false
        }
      });
      console.log('✅ Created test user TEST001 with password "test123"');
    }
    
    console.log('🎉 Password reset completed!');
  } catch (error) {
    console.error('💥 Error resetting passwords:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetPasswords();