const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * Generate a QR code as a data URL (base64 image).
 * @param {string} data - The data to encode (e.g., user ID or token).
 * @param {number} width - Optional width in pixels (default 300).
 * @returns {Promise<string>} - Data URL of the QR code image.
 */
const generateQR = async (data, width = 300) => {
  try {
    return await QRCode.toDataURL(data, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: width,
      color: {
        dark: '#6a11cb',
        light: '#ffffff'
      }
    });
  } catch (error) {
    console.error('QR generation error:', error);
    return null;
  }
};

/**
 * Generate a random UUID token.
 * @returns {string} - UUID v4.
 */
const generateToken = () => {
  return crypto.randomUUID();
};

module.exports = { generateQR, generateToken };