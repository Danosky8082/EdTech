// middleware/noCache.js
// Prevents browsers from caching protected pages (fixes back‑button after logout)

function noCache(req, res, next) {
    // Set headers to disable all caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
}

module.exports = noCache;