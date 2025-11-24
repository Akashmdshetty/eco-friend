// server.js — minimal, robust, and safer dev server for EcoWise
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5000;

// ensure uploads dir exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// file upload handler with size/type limits
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed'), false);
    cb(null, true);
  }
});

// Middleware
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Serve frontend static files
const FRONTEND_DIR = path.join(__dirname, 'frontend');
app.use(express.static(FRONTEND_DIR));

// --- Example API endpoints ---
app.post('/detect', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  // demo response (do not return raw file path in real app)
  res.json({
    detected_objects: [{ name: 'bottle', confidence: 0.92 }],
    recommendations: ['Rinse and recycle at center'],
    carbon_saved_kg: 0.5,
    total_points: 10
  });
});

app.get('/recycling-centers', (req, res) => {
  res.json({
    centers: [
      { id: 1, name: 'Green Earth Center', address: 'MG Road, Hassan', lat: 13.0075, lng: 76.1002, services: ['Plastic','Paper','Glass'] },
      { id: 2, name: 'Community Donation Hub', address: 'Near Town Hall, Hassan', lat: 13.0048, lng: 76.0956, services: ['Books','Clothing'] }
    ]
  });
});

// SPA fallback middleware (no path-to-regexp)
app.use((req, res, next) => {
  const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
  if (req.method === 'GET' && acceptsHtml) {
    return res.sendFile(path.join(FRONTEND_DIR, 'index.html'), (err) => {
      if (err) return next(err);
    });
  }
  next();
});

// Basic error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err && err.stack ? err.stack : err);
  if (!res.headersSent) return res.status(500).json({ error: err.message || 'Internal server error' });
  next(err);
});

app.listen(PORT, () => {
  console.log(`EcoWise dev server listening on http://localhost:${PORT}`);
});
