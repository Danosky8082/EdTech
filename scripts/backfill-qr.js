const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
require('dotenv').config(); // Load environment variables from .env

const prisma = new PrismaClient();

async function backfill() {
  console.log('🔄 Starting QR token backfill...');
  try {
    const users = await prisma.user.findMany({
      where: { qrToken: null },
      select: { id: true }
    });
    console.log(`🔍 Found ${users.length} users without QR token.`);

    for (const user of users) {
      await prisma.user.update({
        where: { id: user.id },
        data: { qrToken: crypto.randomUUID() }
      });
    }
    console.log('✅ QR tokens backfilled.');
  } catch (error) {
    console.error('❌ Backfill failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

backfill();