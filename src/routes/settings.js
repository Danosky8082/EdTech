const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

// Get settings for any role
router.get('/:role/settings', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        
        res.render('settings', {
            user
        });
    } catch (error) {
        console.error('Error loading settings:', error);
        req.flash('error', 'Failed to load settings');
        res.redirect(`/${req.user.role}/dashboard`);
    }
});

// Update account settings
router.post('/:role/settings/update', auth, async (req, res) => {
    try {
        const { email, phone, language, timezone } = req.body;
        
        await User.findByIdAndUpdate(req.user.id, {
            email,
            phone,
            language,
            timezone
        });
        
        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ success: false, message: 'Failed to update settings' });
    }
});

// Change password
router.post('/:role/settings/change-password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        const user = await User.findById(req.user.id);
        
        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ 
                success: false, 
                message: 'Current password is incorrect' 
            });
        }
        
        // Hash new password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        
        await user.save();
        
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ success: false, message: 'Failed to change password' });
    }
});

// Update notification preferences
router.post('/:role/settings/notifications', auth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user.id, {
            $set: {
                'notifications.emailCourseAnnouncements': req.body.emailCourseAnnouncements,
                'notifications.emailAssignmentDeadlines': req.body.emailAssignmentDeadlines,
                'notifications.emailGradeUpdates': req.body.emailGradeUpdates,
                'notifications.pushNewMessages': req.body.pushNewMessages,
                'notifications.pushSystemUpdates': req.body.pushSystemUpdates
            }
        });
        
        res.json({ success: true, message: 'Notification preferences updated' });
    } catch (error) {
        console.error('Error updating notifications:', error);
        res.status(500).json({ success: false, message: 'Failed to update notifications' });
    }
});

// Update privacy settings
router.post('/:role/settings/privacy', auth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user.id, {
            $set: {
                'privacy.profileVisibility': req.body.profileVisibility,
                'privacy.showOnlineStatus': req.body.showOnlineStatus
            }
        });
        
        res.json({ success: true, message: 'Privacy settings updated' });
    } catch (error) {
        console.error('Error updating privacy settings:', error);
        res.status(500).json({ success: false, message: 'Failed to update privacy settings' });
    }
});

// Export data
router.get('/:role/settings/export-data', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        
        // You would implement actual data export logic here
        // For now, just return a placeholder
        res.json({ 
            success: true, 
            message: 'Data export will be implemented soon' 
        });
    } catch (error) {
        console.error('Error exporting data:', error);
        res.status(500).json({ success: false, message: 'Failed to export data' });
    }
});

// Deactivate account
router.post('/:role/settings/deactivate', auth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user.id, {
            status: 'inactive',
            deactivatedAt: new Date()
        });
        
        res.json({ success: true, message: 'Account deactivated' });
    } catch (error) {
        console.error('Error deactivating account:', error);
        res.status(500).json({ success: false, message: 'Failed to deactivate account' });
    }
});

// Delete account
router.delete('/:role/settings/delete', auth, async (req, res) => {
    try {
        // Soft delete - mark as deleted
        await User.findByIdAndUpdate(req.user.id, {
            status: 'deleted',
            deletedAt: new Date()
        });
        
        res.json({ success: true, message: 'Account marked for deletion' });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ success: false, message: 'Failed to delete account' });
    }
});

module.exports = router;