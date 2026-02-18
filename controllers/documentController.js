const { batchProcessDocuments } = require('../services/documentAI');

const processDocument = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        console.log(`Received ${req.files.length} files for processing.`);

        // Call the batch processing service
        const results = await batchProcessDocuments(req.files);
        console.log(results);
        res.json({
            message: 'Batch processing completed',
            results: results
        });

    } catch (error) {
        console.error('Error processing documents:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

module.exports = {
    processDocument
};
