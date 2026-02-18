const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const { processDocument, processSummary } = require('../controllers/documentController');

// POST /api/upload - Classify and Extract
router.post('/upload', upload.array('documents', 5), processDocument);

// POST /api/summarize - Summarize Only
router.post('/summarize', upload.array('documents', 5), processSummary);

module.exports = router;
