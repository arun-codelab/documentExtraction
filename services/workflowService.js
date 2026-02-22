const { ExecutionsClient } = require('@google-cloud/workflows');

const client = new ExecutionsClient();

/**
 * Triggers a Google Cloud Workflow and waits for completion.
 * @param {string} projectId 
 * @param {string} location 
 * @param {string} workflowName 
 * @param {Object} args The arguments to pass to the workflow.
 * @returns {Promise<string>} The result of the workflow execution.
 */
async function triggerAndAwaitWorkflow(projectId, location, workflowName, args) {
    const parent = client.workflowPath(projectId, location, workflowName);

    console.log(`Triggering workflow ${parent}`);

    const [execution] = await client.createExecution({
        parent,
        execution: {
            argument: JSON.stringify(args)
        }
    });

    const executionName = execution.name;
    console.log(`Created execution: ${executionName}`);

    // Poll for completion
    let state = execution.state;
    let currentExecution;

    while (state !== 'SUCCEEDED' && state !== 'FAILED' && state !== 'CANCELLED') {
        console.log(`Waiting for execution ${executionName} to finish... Current state: ${state}`);
        // Wait for 5 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 5000));

        [currentExecution] = await client.getExecution({ name: executionName });
        state = currentExecution.state;
    }

    if (state === 'SUCCEEDED') {
        console.log(`Workflow execution succeeded.`);
        return currentExecution.result;
    } else {
        console.error(`Workflow execution failed with state: ${state}`);
        if (currentExecution.error) {
            console.error(currentExecution.error)
            throw new Error(`Workflow failed: ${currentExecution.error.payload}`);
        }
        throw new Error(`Workflow execution ended with state: ${state}`);
    }
}

module.exports = {
    triggerAndAwaitWorkflow
};
