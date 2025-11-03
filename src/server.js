// server.js
const app = require('./app');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log('Server is running on port', PORT);
  
  // Make a request to the debug endpoint to get routes
  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/debug-routes',
    method: 'GET'
  };
  
  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const routes = JSON.parse(data);
        console.log('\nRegistered routes:');
        console.log('===================');
        routes.forEach(route => {
          console.log(`${route.methods.join(', ')} ${route.path}`);
        });
      } catch (error) {
        console.log('Could not parse route debug information');
      }
    });
  });
  
  req.on('error', (error) => {
    console.log('Could not fetch route debug information:', error.message);
  });
  
  req.end();
});

module.exports = server;