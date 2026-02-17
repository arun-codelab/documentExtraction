const { classifyDocument, extractDocument, getProcessorIdByType } = require('../services/documentAI');

const processDocument = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const buffer = req.file.buffer;
        const mimeType = req.file.mimetype;

        console.log(`Processing file: ${req.file.originalname} (${mimeType})`);

        // 1. Classify the document
        // In a real scenario, you might have a specific classifier processor ID.
        // If not, you might skip this step if the user provides the type, 
        // but the requirement says "take the response from the classifier".
        const classification = await classifyDocument(buffer, mimeType);
        console.log(classification, 'classification');
        if (!classification) {
            console.log('Could not classify document.');
            return res.status(422).json({ error: 'Could not classify document type.' });
        }

        console.log(`Document classified as: ${classification}`);

        // 2. Get the specific processor ID for extraction
        const processorId = getProcessorIdByType(classification);
        console.log(processorId, 'processorId');
        if (!processorId) {
            console.log(`No processor configured for type: ${classification}`);
            return res.status(422).json({
                error: `No extraction processor configured for document type: ${classification}`,
                classification: classification
            });
        }

        // 3. Extract data using the specific processor
        const extractionData = await extractDocument(processorId, buffer, mimeType);

        // 4. Return the results
        res.json({
            message: 'Document processed successfully',
            classification: classification,
            data: extractionData
        });

    } catch (error) {
        console.error('Error processing document:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

module.exports = {
    processDocument
};
