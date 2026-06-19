module.exports = function activityTracker() {
  return function(req, res, next) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  };
};