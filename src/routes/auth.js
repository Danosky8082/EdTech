const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated } = require('../middleware/auth');

// Login routes
router.get('/login', authController.showLogin);
router.post('/login', authController.login);

// Password change routes
router.get('/change-password', isAuthenticated, authController.showChangePassword);
router.post('/change-password', isAuthenticated, authController.changePassword);

// Logout route
router.get('/logout', authController.logout);



module.exports = router;