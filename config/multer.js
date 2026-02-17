const multer = require('multer');

// Configure multer to store files in memory
const storage = multer.memoryStorage();

// Create the multer instance
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // Limit file size to 10MB
  },
});

module.exports = upload;
