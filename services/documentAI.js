const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Initialize clients
const client = new DocumentProcessorServiceClient();
const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME;

/**
 * Uploads files to Google Cloud Storage.
 * @param {Array} files - Array of multer file objects.
 * @returns {Promise<Array<string>>} - Array of GCS URIs.
 */
async function uploadFilesToGCS(files) {
    const batchId = uuidv4();
    const gcsUris = [];

    console.log(`Uploading ${files.length} files to GCS bucket ${bucketName}...`);

    for (const file of files) {
        const fileName = `input/${batchId}/${file.originalname}`;
        const fileBuffer = file.buffer;

        await storage.bucket(bucketName).file(fileName).save(fileBuffer);

        const gcsUri = `gs://${bucketName}/${fileName}`;
        gcsUris.push({
            gcsUri: gcsUri,
            mimeType: file.mimetype
        });
        console.log(`Uploaded ${fileName}`);
    }

    return { gcsUris, batchId };
}

/**
 * Classifies a single document content (helper for batch logic if needed locally, 
 * but for batch processing we typically use the processor directly).
 * 
 * NOTE: For batch processing with different document types, 
 * we ideally need a Classifier Processor to split/classify first, 
 * OR we assume all uploaded files are of the same type?
 * 
 * The user requirement says: "take the response from the classifier based on the type... call independent processors".
 * 
 * Configuring Batch Process for Classification:
 * We will send all files to the Classifier Processor first using batchProcessDocuments.
 */
async function batchProcessDocuments(files) {
    if (!bucketName) {
        throw new Error('GCS_BUCKET_NAME is not defined in .env');
    }

    // 1. Upload files to GCS
    const { gcsUris, batchId } = await uploadFilesToGCS(files);
    console.log(gcsUris, 'gcsUris------------');
    // 2. Prepare Input Config for Classifier
    const inputDocuments = {
        gcsDocuments: {
            documents: gcsUris
        }
    };

    const outputUriPrefix = `gs://${bucketName}/output/${batchId}/classification/`;
    const documentOutputConfig = {
        gcsOutputConfig: {
            gcsUri: outputUriPrefix
        }
    };

    // 3. Call Batch Process on Classifier
    const classifierProcessorId = process.env.CLASSIFIER_PROCESSOR_ID;
    const name = `projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/processors/${classifierProcessorId}`;

    const request = {
        name,
        inputDocuments,
        documentOutputConfig,
    };

    console.log('Starting Batch Classification...');
    // Poll for completion
    const [operation] = await client.batchProcessDocuments(request);
    await operation.promise();
    console.log('Batch Classification Completed.');

    // 4. Download Results and Determine Next Steps
    const classificationResults = await downloadResults(outputUriPrefix);

    // 5. Route to specific processors based on classification
    // This is complex because we prefer to do 1 batch call per processor type if possible,
    // or we have to loop.
    // Let's analyze the classification results.

    const extractionResults = [];

    // Group files by detected type to minimize batch calls
    const filesByType = {};

    for (const res of classificationResults) {
        // Parse the classification from the document content
        // Document AI Batch output is a JSON file representing the Document object
        const document = res.document;
        const sourceGcsUri = getSourceGcsUriFromDocument(document); // Need to track which file this is

        let documentType = null;
        if (document.entities && document.entities.length > 0) {
            const topEntity = document.entities.sort((a, b) => b.confidence - a.confidence)[0];
            console.log(`Top entity for file ${res.fileName}: ${topEntity.type} with confidence ${topEntity.confidence}`);
            if (topEntity.confidence >= 0.7) {
                documentType = topEntity.type;
            }
        }

        if (documentType) {
            if (!filesByType[documentType]) {
                filesByType[documentType] = [];
            }
            // We need to pass the original input GCS URI or the Output GCS URI?
            // Usually we extract from the *original* file. 
            // So we need to map back to the input GCS URI.
            // But wait, the classification result *is* the document. 
            // If we want to run extraction, we should run it on the *original* file mostly.
            // Or we can run it on the *output* of the classifier if it hasn't modified the text/content.
            // Let's use the original GCS URI for extraction to be safe.

            // Note: The Document object in the JSON output usually contains the `shardInfo` or `text` but maybe not the original `gcsUri`.
            // However, the filenames in output usually match input, or we can track by order?
            // Actually, for simplicity, since we have the list of `gcsUris` (Input), we can try to map them.
            // But a robust way is to re-upload or just use the same input URI if we can identify it.

            // Let's just push the *original* object from `gcsUris` that matches.
            // Currently, matching output JSON to input file can be tricky without parsing the filename in the JSON output path.
            // The JSON output filename is usually `input_filename-0.json`.

            console.log(`Mapping output ${res.fileName} to input...`);
            // Output filename format from Document AI typically appends -0.json (or -1.json etc for multiple shards)
            // Example: a_01-0.json -> a_01
            const outputBasename = path.basename(res.fileName).replace(/-[0-9]+\.json$/, '');
            console.log(`Derived output basename: ${outputBasename}`);

            // Find original GCS URI matching this basename (ignoring extension of input file)
            const originalInput = gcsUris.find(u => {
                const inputFileName = path.basename(u.gcsUri); // e.g., a_01.jpg
                const inputBasename = inputFileName.replace(path.extname(inputFileName), ''); // e.g., a_01
                return inputBasename === outputBasename;
            });

            if (originalInput) {
                console.log(`Found match: ${originalInput.gcsUri}`);
                filesByType[documentType].push(originalInput);
            } else {
                console.log(`No input match found for ${outputBasename} in ${JSON.stringify(gcsUris.map(u => u.gcsUri))}`);
            }
        } else {
            extractionResults.push({
                file: res.fileName,
                error: 'Could not classify document or confidence too low.'
            });
        }
    }
    console.log(filesByType, 'fileByType')
    // 6. Execute Batch Extraction for each type
    for (const [type, files] of Object.entries(filesByType)) {
        console.log(`Processing files for type: ${type}`);
        const processorId = getProcessorIdByType(type);
        console.log(`Processor ID for type ${type}: ${processorId}`);
        if (processorId) {
            console.log(`Starting Batch Extraction for ${type} (${files.length} files)...`);

            if (files.length === 0) {
                console.log(`Skipping batch extraction for ${type} as there are no matching input files.`);
                continue;
            }
            const typeBatchId = uuidv4();
            const typeOutputPrefix = `gs://${bucketName}/output/${batchId}/extraction/${type}/`;

            const typeInputRequest = {
                name: `projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/processors/${processorId}`,
                inputDocuments: {
                    gcsDocuments: {
                        documents: files
                    }
                },
                documentOutputConfig: {
                    gcsOutputConfig: {
                        gcsUri: typeOutputPrefix
                    }
                }
            };

            const [typeOp] = await client.batchProcessDocuments(typeInputRequest);
            await typeOp.promise();

            const typeResults = await downloadResults(typeOutputPrefix);
            console.log(typeResults, 'typeResults')
            // Process results into final format
            for (const tRes of typeResults) {
                const extractedData = {};
                if (tRes.document.entities) {
                    console.log(tRes.document.entities, 'entities')
                    tRes.document.entities.forEach(entity => {
                        extractedData[entity.type] = entity.mentionText || entity.normalizedValue?.text;
                    });
                }
                extractionResults.push({
                    type: type,
                    data: extractedData,
                    sourceFile: tRes.fileName // approximation
                });
            }

        } else {
            console.log(`No processor found for type ${type}`);
        }
    }

    // 7. Cleanup (Optional: logic to delete GCS files)
    // await storage.bucket(bucketName).deleteFiles({ prefix: `input/${batchId}/` });
    // await storage.bucket(bucketName).deleteFiles({ prefix: `output/${batchId}/` });

    return extractionResults;
}

/**
 * Downloads all JSON files from a GCS prefix and parses them.
 */
async function downloadResults(prefix) {
    // Strip gs://bucketName/ if present to get the relative path within the bucket
    let relativePrefix = prefix;
    if (prefix.startsWith('gs://')) {
        const parts = prefix.split(bucketName + '/');
        if (parts.length > 1) {
            relativePrefix = parts[1];
        }
    }

    console.log(`Downloading results from prefix: ${relativePrefix}`);

    try {
        const [files] = await storage.bucket(bucketName).getFiles({ prefix: relativePrefix });
        console.log(`Found ${files.length} files in GCS under prefix ${relativePrefix}`);

        const results = [];

        for (const file of files) {
            if (file.name.endsWith('.json')) {
                console.log(`Downloading file: ${file.name}`);
                const [content] = await file.download();
                const document = JSON.parse(content.toString());
                results.push({
                    fileName: file.name,
                    document: document
                });
            }
        }
        return results;
    } catch (error) {
        console.error('Error in downloadResults:', error);
        return [];
    }
}

function getSourceGcsUriFromDocument(document) {
    // Helper to find source if needed, often not directly in Document object unless in shardInfo
    return null;
}


/**
 * Gets the processor ID based on the document type.
 */
function getProcessorIdByType(type) {
    const normalizedType = type ? type : '';
    switch (normalizedType) {
        case 'adharCard': // Handle potential variations
            return process.env.AADHAR_PROCESSOR_ID;
        case 'Pancard':
            return process.env.PAN_PROCESSOR_ID;
        case 'invoice':
            return process.env.INVOICE_PROCESSOR_ID;
        default:
            return null;
    }
}

/**
 * Summarizes documents using the Summary Processor.
 */
async function batchSummarizeDocuments(files) {
    if (!bucketName) {
        throw new Error('GCS_BUCKET_NAME is not defined in .env');
    }
    const processorId = process.env.SUMMARIZER_PROCESSOR_ID;
    if (!processorId) {
        throw new Error('SUMMARIZER_PROCESSOR_ID is not defined in .env');
    }

    console.log(`Starting Batch Summarization with processor ${processorId}...`);

    // 1. Upload files
    const { gcsUris, batchId } = await uploadFilesToGCS(files);

    // 2. Prepare Input/Output Config
    const outputPrefix = `gs://${bucketName}/output/${batchId}/summary/`;
    const inputDocuments = {
        gcsDocuments: { documents: gcsUris }
    };
    const documentOutputConfig = {
        gcsOutputConfig: { gcsUri: outputPrefix }
    };

    const name = `projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/processors/${processorId}`;
    const request = {
        name,
        inputDocuments,
        documentOutputConfig,
    };

    // 3. Execute Batch Process
    console.log('Sending request to Document AI Summary Processor...');
    const [operation] = await client.batchProcessDocuments(request);
    await operation.promise();
    console.log('Batch Summarization Completed.');

    // 4. Download and Parse Results
    const results = await downloadResults(outputPrefix);
    const summaryResults = [];

    for (const res of results) {
        const document = res.document;

        // Extract summary text (check entities first which is common for generative processors)
        let summaryText = document.text;
        if (document.entities && document.entities.length > 0) {
            const entitySummaries = document.entities.map(e => e.mentionText || e.normalizedValue?.text).join('\n');
            if (entitySummaries && entitySummaries.length > 0) {
                summaryText = entitySummaries;
            }
        }

        summaryResults.push({
            file: res.fileName,
            summary: summaryText
        });
    }

    return summaryResults;
}

module.exports = {
    batchProcessDocuments,
    batchSummarizeDocuments,
    uploadFilesToGCS
};
