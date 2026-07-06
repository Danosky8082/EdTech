const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function backfill() {
  console.log('🔄 Starting QR token backfill...');

  // Find all users who don't have a QR token
  const users = await prisma.user.findMany({
    where: { qrToken: null }
  });

  console.log(`📊 Found ${users.length} users without QR tokens`);

  if (users.length === 0) {
    console.log('✅ All users already have QR tokens. Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const user of users) {
    const token = crypto.randomUUID();
    await prisma.user.update({
      where: { id: user.id },
      data: { qrToken: token }
    });
    updated++;
    if (updated % 10 === 0) {
      console.log(`⏳ Processed ${updated} users...`);
    }
  }

  console.log(`✅ Successfully added QR tokens to ${updated} users.`);
  await prisma.$disconnect();
}

// Run the backfill
backfill().catch((error) => {
  console.error('❌ Backfill failed:', error);
  process.exit(1);
});