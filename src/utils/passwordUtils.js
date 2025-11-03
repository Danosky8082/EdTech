const bcrypt = require('bcrypt');

const hashPassword = async (password) => {
  try {
    if (!password) {
      throw new Error('Password is required');
    }
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    console.error('Password hashing error:', error);
    throw new Error('Password hashing failed');
  }
};

const comparePassword = async (password, hashedPassword) => {
  try {
    if (!password || !hashedPassword) {
      console.log('Missing password or hash for comparison');
      return false;
    }
    
    // Ensure both are strings
    const cleanPassword = String(password).trim();
    const cleanHash = String(hashedPassword).trim();
    
    if (!cleanPassword || !cleanHash) {
      console.log('Empty password or hash after cleaning');
      return false;
    }
    
    const isMatch = await bcrypt.compare(cleanPassword, cleanHash);
    console.log(`Password comparison result: ${isMatch}`);
    return isMatch;
  } catch (error) {
    console.error('Password comparison error:', error);
    return false;
  }
};

module.exports = { hashPassword, comparePassword };