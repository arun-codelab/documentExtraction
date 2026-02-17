const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
require('dotenv').config();

// Initialize the client
const client = new DocumentProcessorServiceClient();

/**
 * Classifies the document to determine its type.
 * @param {Buffer} buffer - The file buffer.
 * @param {string} mimeType - The file mime type.
 * @returns {Promise<string|null>} - The determined document type (e.g., 'AADHAR', 'PAN', 'INVOICE') or null.
 */
async function classifyDocument(buffer, mimeType) {
    const name = `projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/processors/${process.env.CLASSIFIER_PROCESSOR_ID}`;

    const request = {
        name,
        rawDocument: {
            content: buffer.toString('base64'),
            mimeType: mimeType,
        },
    };

    const [result] = await client.processDocument(request);
    const { document } = result;

    // Assuming the classifier returns entities where the type is the class
    // or checks the entities/pages to find the classification.
    // For standard classifiers, it often returns entities with confidence.

    if (document.entities && document.entities.length > 0) {
        // Return the type of the entity with the highest confidence
        console.log(document.entities, 'document.entities');
        const topEntity = document.entities.sort((a, b) => b.confidence - a.confidence)[0];

        console.log(`Classified as ${topEntity.type} with confidence ${topEntity.confidence}`);

        if (topEntity.confidence >= 0.9) {
            return topEntity.type;
        } else {
            console.log(`Confidence score ${topEntity.confidence} is below threshold 0.7`);
            return null;
        }
    }

    return null;
}

/**
 * Extracts data from the document using the specified processor.
 * @param {string} processorId - The processor ID to use.
 * @param {Buffer} buffer - The file buffer.
 * @param {string} mimeType - The file mime type.
 * @returns {Promise<object>} - The extracted data.
 */
async function extractDocument(processorId, buffer, mimeType) {
    const name = `projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/processors/${processorId}`;

    const request = {
        name,
        rawDocument: {
            content: buffer.toString('base64'),
            mimeType: mimeType,
        },
    };

    const [result] = await client.processDocument(request);
    const { document } = result;

    console.log('Document extraction completed.');

    // Extract key-value pairs or entities
    const extractedData = {};
    if (document.entities) {
        document.entities.forEach(entity => {
            extractedData[entity.type] = entity.mentionText || entity.normalizedValue?.text;
        });
    }

    return extractedData;
}

/**
 * Gets the processor ID based on the document type.
 * @param {string} type - The document type.
 * @returns {string|null} - The processor ID.
 */
function getProcessorIdByType(type) {
    const normalizedType = type ? type : '';

    switch (normalizedType) {
        case 'AADHAR':
        case 'adharCard': // Handle potential variations
            return process.env.AADHAR_PROCESSOR_ID;
        case 'PAN':
        case 'Pancard':
            return process.env.PAN_PROCESSOR_ID;
        case 'invoice':
            return process.env.INVOICE_PROCESSOR_ID;
        default:
            return null;
    }
}

module.exports = {
    classifyDocument,
    extractDocument,
    getProcessorIdByType
};
