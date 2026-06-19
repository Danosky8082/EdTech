// src/middleware/activityTracker.js
module.exports = function activityTracker() {
  return function(req, res, next) {
    // Only log – never send a response
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  };
};