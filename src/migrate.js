// migrate.js
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function runMigrations() {
  try {
    console.log('🚀 Starting database migration...');
    
    // Step 1: Generate migration
    console.log('📦 Generating migration...');
    const { stdout: migrateOutput } = await execAsync('npx prisma migrate dev --name add_financial_tables');
    console.log('✅ Migration generated:', migrateOutput);
    
    // Step 2: Generate Prisma Client
    console.log('🔧 Generating Prisma Client...');
    const { stdout: generateOutput } = await execAsync('npx prisma generate');
    console.log('✅ Prisma Client generated:', generateOutput);
    
    console.log('🎉 Migration completed successfully!');
    console.log('📋 Next steps:');
    console.log('   1. Restart your server: npm run dev');
    console.log('   2. Test the application');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('💡 Alternative migration method:');
    console.log('   npx prisma db push --force-reset');
  }
}

runMigrations();