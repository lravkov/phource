const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Set no-cache headers for all responses (prevent stale JS/CSS)
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    },
}));

app.listen(port, () => {
    console.log(`phource server listening at http://localhost:${port}`);
    console.log(`Place your .phource log file at public/phource.log`);
});

app.on('error', (error) => {
    console.error('Server error:', error);
});
