// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const PORT = process.env.PORT || 4000;
const AI_SERVER = process.env.AI_SERVER_URL || 'http://127.0.0.1:5000/analyze';

const app = express();

// static frontend (if any)
app.use(express.static(path.join(__dirname, 'frontend')));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}_${file.originalname.replace(/\s+/g,'_')}`;
    cb(null, unique);
  }
});
const upload = multer({ storage });

// simple route
app.get('/health', (req, res) => res.json({ status: 'ok', ai_server: AI_SERVER }));

// POST /detect - accepts image upload from frontend, forwards to Python AI server
app.post('/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'no image uploaded' });

    const username = req.body.username || 'guest';
    const filePath = req.file.path;

    // Build form-data to forward
    const form = new FormData();
    form.append('image', fs.createReadStream(filePath), req.file.originalname);
    form.append('username', username);

    // forward to AI server
    const aiRes = await axios.post(AI_SERVER, form, {
      headers: {
        ...form.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60_000
    });

    const aiData = aiRes.data || {};
    // attach filename and local path info
    aiData.filename = req.file.originalname;
    aiData.local_saved_path = filePath;

    // NOTE: integrate DB recording here if you want (calls to SQLite, etc.)
    return res.json(aiData);
  } catch (err) {
    console.error('Error in /detect:', err?.toString());
    const msg = err?.response?.data || err.message || 'unknown error';
    return res.status(500).json({ success: false, error: 'forwarding_failed', detail: msg });
  }
});

// fallback SPA route (serve index)
app.get('*', (req, res) => {
  const index = path.join(__dirname, 'frontend', 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  return res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`Node server running on port ${PORT} - forwarding AI → ${AI_SERVER}`);
});
