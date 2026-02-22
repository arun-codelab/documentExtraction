const { batchProcessDocuments, batchSummarizeDocuments, uploadFilesToGCS } = require('../services/documentAI');
const { triggerAndAwaitWorkflow } = require('../services/workflowService');

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

const processSummary = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        console.log(`Received ${req.files.length} files for summarization.`);

        // Call the batch summarization service
        // Note: This is a separate process from classification/extraction as requested.
        const results = await batchSummarizeDocuments(req.files);

        res.json({
            message: 'Batch summarization completed',
            results: results
        });

    } catch (error) {
        console.error('Error summarizing documents:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

const processWithWorkflow = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        console.log(`Received ${req.files.length} files for workflow processing.`);

        // 1. Upload files to GCS
        const { gcsUris, batchId } = await uploadFilesToGCS(req.files);

        // 2. Trigger Workflow
        const projectId = process.env.PROJECT_ID;
        const location = process.env.WORKFLOW_LOCATION || process.env.LOCATION;
        const workflowName = process.env.WORKFLOW_NAME;

        if (!workflowName) {
            throw new Error('WORKFLOW_NAME is not defined in environment variables.');
        }

        const workflowArgs = {
            bucket: batchId,
            files: gcsUris.map(u => u.gcsUri)
        };
        console.log(workflowArgs, 'workflowArgs------------');
        const result = await triggerAndAwaitWorkflow(projectId, location, workflowName, workflowArgs);

        res.json({
            message: 'Workflow processing completed successfully',
            result: JSON.parse(result)
        });

    } catch (error) {
        console.error('Error processing documents with workflow:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

module.exports = {
    processDocument,
    processSummary,
    processWithWorkflow
};
