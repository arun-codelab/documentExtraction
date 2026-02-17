const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const { processDocument } = require('../controllers/documentController');

// POST /api/upload
router.post('/upload', upload.single('document'), processDocument);

module.exports = router;
