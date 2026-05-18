const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Activity = require('../models/Activity');

// Get profile for any role
router.get('/:role/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        
        // Get role-specific info based on user role
        let roleInfo = null;
        let stats = {};
        
        switch (user.role) {
            case 'admin':
                const Admin = require('../models/Admin');
                roleInfo = await Admin.findOne({ userId: user._id });
                stats = await getAdminStats(user);
                break;
            case 'student':
                const Student = require('../models/Student');
                roleInfo = await Student.findOne({ userId: user._id });
                stats = await getStudentStats(user);
                break;
            case 'teacher':
                const Teacher = require('../models/Teacher');
                roleInfo = await Teacher.findOne({ userId: user._id });
                stats = await getTeacherStats(user);
                break;
            case 'parent':
                const Parent = require('../models/Parent');
                roleInfo = await Parent.findOne({ userId: user._id });
                stats = await getParentStats(user);
                break;
            case 'cashier':
                const Cashier = require('../models/Cashier');
                roleInfo = await Cashier.findOne({ userId: user._id });
                stats = await getCashierStats(user);
                break;
            case 'accountant':
                const Accountant = require('../models/Accountant');
                roleInfo = await Accountant.findOne({ userId: user._id });
                stats = await getAccountantStats(user);
                break;
        }
        
        // Get recent activities
        const recentActivities = await Activity.find({ userId: user._id })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();
        
        res.render('profile', {
            user,
            adminInfo: user.role === 'admin' ? roleInfo : null,
            studentInfo: user.role === 'student' ? roleInfo : null,
            teacherInfo: user.role === 'teacher' ? roleInfo : null,
            parentInfo: user.role === 'parent' ? roleInfo : null,
            cashierInfo: user.role === 'cashier' ? roleInfo : null,
            accountantInfo: user.role === 'accountant' ? roleInfo : null,
            stats,
            recentActivities
        });
    } catch (error) {
        console.error('Error loading profile:', error);
        req.flash('error', 'Failed to load profile');
        res.redirect(`/${req.user.role}/dashboard`);
    }
});

// Update profile for any role
router.post('/:role/profile/update', auth, async (req, res) => {
    try {
        const { firstName, lastName, phone, gender, dateOfBirth, address } = req.body;
        
        await User.findByIdAndUpdate(req.user.id, {
            firstName,
            lastName,
            phone,
            gender,
            dateOfBirth,
            address
        });
        
        // Log activity
        await Activity.create({
            userId: req.user.id,
            action: 'Updated profile',
            details: 'User updated their profile information'
        });
        
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

// Upload avatar
router.post('/:role/profile/avatar', auth, async (req, res) => {
    try {
        if (!req.files || !req.files.avatar) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        
        const avatar = req.files.avatar;
        const fileName = `avatar_${req.user.id}_${Date.now()}${path.extname(avatar.name)}`;
        
        // Save file
        await avatar.mv(`./public/uploads/avatars/${fileName}`);
        
        // Update user
        await User.findByIdAndUpdate(req.user.id, {
            avatar: `/uploads/avatars/${fileName}`
        });
        
        res.json({ 
            success: true, 
            message: 'Avatar updated successfully',
            avatarUrl: `/uploads/avatars/${fileName}`
        });
    } catch (error) {
        console.error('Error uploading avatar:', error);
        res.status(500).json({ success: false, message: 'Failed to upload avatar' });
    }
});

// Helper functions for stats
async function getAdminStats(user) {
    const UserModel = require('../models/User');
    const Class = require('../models/Class');
    const Transaction = require('../models/Transaction');
    
    return {
        totalUsers: await UserModel.countDocuments(),
        activeClasses: await Class.countDocuments({ status: 'active' }),
        revenue: 0, // You would implement this based on your Transaction model
        pendingTasks: 0
    };
}

async function getStudentStats(user) {
    const Enrollment = require('../models/Enrollment');
    const AssignmentSubmission = require('../models/AssignmentSubmission');
    
    return {
        totalCourses: await Enrollment.countDocuments({ studentId: user._id }),
        completedAssignments: await AssignmentSubmission.countDocuments({ 
            studentId: user._id, 
            status: 'submitted' 
        }),
        averageGrade: 0,
        attendanceRate: 0
    };
}

// Add similar functions for other roles...

module.exports = router;