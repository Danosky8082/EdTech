// src/server.js
const app = require('./app');               // Your Express app
const http = require('http');

// ============================================================
// IMPORT CRON JOBS (only if not in Vercel serverless environment)
// Vercel does not support persistent background processes,
// so we only run the cron job when the app is running as a
// standalone server (e.g., locally or on a VPS).
// ============================================================
if (!process.env.VERCEL) {
  require('./jobs/overdueCheck');
}

// Attach any additional routers (if not already in app.js)
const teacherRouter = require('./routes/teacher');
app.use('/teacher', teacherRouter);

// ------------------------------------------------------------
// Export the Express app for Vercel serverless environment.
// Vercel will call this exported handler for each request.
// ------------------------------------------------------------
module.exports = app;

// ------------------------------------------------------------
// Start the server only when NOT running on Vercel.
// (Vercel provides its own listening environment.)
// ------------------------------------------------------------
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running locally on port ${PORT}`);

    // Optional: debug route introspection (only in development)
    if (process.env.NODE_ENV === 'development') {
      const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/debug-routes',
        method: 'GET',
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const routes = JSON.parse(data);
            console.log('\n📋 Registered routes:');
            console.log('=====================');
            routes.forEach(route => {
              console.log(`${route.methods.join(', ')} ${route.path}`);
            });
          } catch (_) {
            console.log('Could not parse route debug information');
          }
        });
      });
      req.on('error', () => console.log('Could not fetch route debug info.'));
      req.end();
    }
  });

  // Optional: export the server instance if needed elsewhere
  module.exports.server = server;
}