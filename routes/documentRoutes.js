const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const { processDocument } = require('../controllers/documentController');

// POST /api/upload
router.post('/upload', upload.array('documents', 5), processDocument);

module.exports = router;
