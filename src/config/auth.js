// Middleware to check if user is authenticated
const ensureAuthenticated = (req, res, next) => {
  if (req.session.user) {
    return next();
  }
  req.flash('error_msg', 'Please log in to view that resource');
  res.redirect('/auth/login');
};

// Middleware to check if user is a parent
const ensureParent = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'parent') {
    return next();
  }
  req.flash('error_msg', 'Please log in as parent to access that resource');
  res.redirect('/auth/login');
};

// Middleware to check if user is a student
const ensureStudent = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'student') {
    return next();
  }
  req.flash('error_msg', 'Please log in as student to access that resource');
  res.redirect('/auth/login');
};

// Middleware to check if user is a teacher
const ensureTeacher = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'teacher') {
    return next();
  }
  req.flash('error_msg', 'Please log in as teacher to access that resource');
  res.redirect('/auth/login');
};

// Middleware to check if user is an admin
const ensureAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  req.flash('error_msg', 'Please log in as administrator to access that resource');
  res.redirect('/auth/login');
};

function ensureRole(roles) {
    return function(req, res, next) {
        if (req.isAuthenticated()) {
            if (typeof roles === 'string') {
                roles = [roles];
            }
            if (roles.includes(req.user.role)) {
                return next();
            } else {
                req.flash('error_msg', 'You are not authorized to view that resource');
                res.redirect('/dashboard');
            }
        } else {
            req.flash('error_msg', 'Please log in to view that resource');
            res.redirect('/login');
        }
    };
}

module.exports = {
  ensureAuthenticated,
  ensureParent,
  ensureStudent,
  ensureTeacher,
  ensureAdmin
};