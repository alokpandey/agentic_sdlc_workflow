const express = require('express');
const router = express.Router();
const Workflow = require('../models/workflow');
const WorkflowTemplate = require('../models/workflowTemplate');
const WorkflowExecution = require('../models/workflowExecution');
const { Client } = require('@temporalio/client');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../middleware/rbac');

// GET /api/workflows - Get all workflows
router.get('/', authenticateToken, requirePermission(PERMISSIONS.WORKFLOW_VIEW), async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      template_id: req.query.template_id
    };
    const workflows = await Workflow.findAll(filters);
    res.json({ success: true, data: workflows });
  } catch (error) {
    console.error('Error fetching workflows:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/workflows/:id - Get workflow by ID
router.get('/:id', authenticateToken, requirePermission(PERMISSIONS.WORKFLOW_VIEW), async (req, res) => {
  try {
    const workflow = await Workflow.findByIdWithTemplate(req.params.id);
    if (!workflow) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }
    res.json({ success: true, data: workflow });
  } catch (error) {
    console.error('Error fetching workflow:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/workflows - Create new workflow
router.post('/', authenticateToken, requirePermission(PERMISSIONS.WORKFLOW_CREATE), async (req, res) => {
  try {
    // Validate workflow name is provided
    if (!req.body.name || req.body.name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Workflow name is required'
      });
    }

    // Validate that nodes are provided
    if (!req.body.nodes || !Array.isArray(req.body.nodes) || req.body.nodes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Workflow must have at least one node'
      });
    }

    // Check for duplicate name
    const existingWorkflow = await Workflow.findByName(req.body.name);
    if (existingWorkflow) {
      return res.status(409).json({
        success: false,
        error: `A workflow with the name "${req.body.name}" already exists. Please choose a different name.`,
        code: 'DUPLICATE_NAME'
      });
    }

    // Convert nodes/edges to Temporal workflow steps
    const workflowSteps = convertNodesToSteps(req.body.nodes, req.body.edges);

    const workflowData = {
      name: req.body.name,
      description: req.body.description,
      template_id: req.body.template_id,
      nodes: req.body.nodes,
      edges: req.body.edges,
      configuration: {
        ...req.body.configuration,
        temporalSteps: workflowSteps // Store the converted steps for execution
      },
      created_by: req.body.created_by || req.headers['x-user-id'] || 'anonymous'
    };

    const workflow = await Workflow.create(workflowData);

    console.log(`✅ Workflow created: ${workflow.name} (ID: ${workflow.id})`);
    console.log(`   Steps: ${workflowSteps.length} steps`);

    res.status(201).json({ success: true, data: workflow });
  } catch (error) {
    console.error('Error creating workflow:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Convert workflow nodes and edges to Temporal workflow steps
 * This creates an execution plan from the visual workflow
 */
function convertNodesToSteps(nodes, edges) {
  if (!nodes || nodes.length === 0) {
    return [];
  }

  // Build adjacency map from edges
  const adjacencyMap = {};
  if (edges && edges.length > 0) {
    edges.forEach(edge => {
      if (!adjacencyMap[edge.source]) {
        adjacencyMap[edge.source] = [];
      }
      adjacencyMap[edge.source].push(edge.target);
    });
  }

  // Find start node
  const startNode = nodes.find(n => n.type === 'start' || n.data?.type === 'start');
  if (!startNode) {
    throw new Error('Workflow must have a start node');
  }

  // Traverse nodes in order using BFS
  const steps = [];
  const visited = new Set();
  const queue = [startNode.id];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodes.find(n => n.id === nodeId);
    if (!node) continue;

    // Skip start and end nodes in execution
    const nodeType = node.type || node.data?.type;
    if (nodeType === 'start' || nodeType === 'end') {
      // Add children to queue
      if (adjacencyMap[nodeId]) {
        queue.push(...adjacencyMap[nodeId]);
      }
      continue;
    }

    // Create step from node
    const nodeConfig = node.data?.config || {};

    // Map node config to template workflow config format
    const stepConfig = { ...nodeConfig };

    // For agent nodes, map agentType to agentId and agentName
    if (nodeType === 'agent') {
      const agentType = nodeConfig.agentType || 'epic';
      stepConfig.agentId = `${agentType}-agent`;
      stepConfig.agentName = agentType.charAt(0).toUpperCase() + agentType.slice(1) + ' Agent';

      // If there's a custom prompt, use it; otherwise use a default
      if (!stepConfig.prompt) {
        stepConfig.prompt = `Execute ${agentType} agent task`;
      }
    }

    const step = {
      id: node.id,
      name: node.data?.label || node.data?.name || `Step ${steps.length + 1}`,
      type: nodeType,
      config: stepConfig
    };

    steps.push(step);

    // Add children to queue
    if (adjacencyMap[nodeId]) {
      queue.push(...adjacencyMap[nodeId]);
    }
  }

  return steps;
}

// PUT /api/workflows/:id - Update workflow
router.put('/:id', authenticateToken, requirePermission(PERMISSIONS.WORKFLOW_EDIT), async (req, res) => {
  try {
    // Check if workflow exists
    const existingWorkflow = await Workflow.findById(req.params.id);
    if (!existingWorkflow) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    // If name is being changed, check for duplicates
    if (req.body.name && req.body.name !== existingWorkflow.name) {
      const duplicateWorkflow = await Workflow.findByName(req.body.name, req.params.id);
      if (duplicateWorkflow) {
        return res.status(409).json({
          success: false,
          error: `A workflow with the name "${req.body.name}" already exists. Please choose a different name.`,
          code: 'DUPLICATE_NAME'
        });
      }
    }

    // Convert nodes/edges to Temporal workflow steps (same as create)
    let workflowSteps = [];
    if (req.body.nodes && req.body.nodes.length > 0) {
      workflowSteps = convertNodesToSteps(req.body.nodes, req.body.edges || []);
    }

    const workflowData = {
      name: req.body.name,
      description: req.body.description,
      nodes: req.body.nodes,
      edges: req.body.edges,
      configuration: {
        ...req.body.configuration,
        temporalSteps: workflowSteps // Store the converted steps for execution
      },
      status: req.body.status,
      last_modified_by: req.body.last_modified_by || req.headers['x-user-id'] || 'anonymous'
    };

    const workflow = await Workflow.update(req.params.id, workflowData);

    console.log(`✅ Workflow updated: ${workflow.name} (ID: ${workflow.id})`);
    console.log(`   Steps: ${workflowSteps.length} steps`);

    res.json({ success: true, data: workflow });
  } catch (error) {
    console.error('Error updating workflow:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/workflows/:id/execute - Execute workflow via Temporal
router.post('/:id/execute', authenticateToken, requirePermission(PERMISSIONS.WORKFLOW_EXECUTE), async (req, res) => {
  try {
    const workflow = await Workflow.findByIdWithTemplate(req.params.id);
    if (!workflow) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    // import temporal client utility
    const { createTemporalClient } = require('../utils/temporalClient');
    const { v4: uuidv4 } = require('uuid');

    // connect to temporal server (with TLS support for Temporal Cloud)
    const client = await createTemporalClient();

    // prepare workflow input based on configuration
    const workflowId = `workflow-${workflow.id}-${uuidv4()}`;

    // Use execution-specific output directory to avoid conflicts between concurrent executions
    const baseOutputDir = req.body.outputDir || workflow.configuration?.outputDir || 'sdlc-artifacts';
    const executionOutputDir = `${baseOutputDir}/executions/${workflowId}`;

    // Get workflow steps from configuration (created during save)
    const workflowSteps = workflow.configuration?.temporalSteps || [];

    if (workflowSteps.length === 0) {
      // Fallback: convert nodes to steps if not already done
      const nodes = typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : workflow.nodes;
      const edges = typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) : workflow.edges;
      workflowSteps.push(...convertNodesToSteps(nodes, edges));
    }

    console.log(`\n🚀 Executing workflow: ${workflow.name}`);
    console.log(`   Workflow ID: ${workflowId}`);
    console.log(`   Steps: ${workflowSteps.length}`);
    workflowSteps.forEach((step, i) => {
      console.log(`   ${i + 1}. ${step.name} (${step.type})`);
    });

    // Create a dynamic template for this workflow
    const dynamicTemplate = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description || '',
      version: workflow.version || 1,
      steps: workflowSteps
    };

    // Use templateWorkflow with dynamic template
    const workflowName = 'templateWorkflow';
    const workflowInput = {
      workflowId: workflowId,
      templateId: `dynamic-${workflow.id}`, // Mark as dynamic template
      template: dynamicTemplate, // Pass the template inline
      parameters: {
        brdPath: req.body.brdPath || workflow.configuration?.brdPath || 'requirements/sample-brd.md',
        workspaceRoot: req.body.workspaceRoot || process.env.WORKSPACE_ROOT || process.cwd(),
        contextDirs: req.body.contextDirs ? (Array.isArray(req.body.contextDirs) ? req.body.contextDirs : req.body.contextDirs.split(',').map(d => d.trim())) : (workflow.configuration?.contextDirs || []),
        outputDir: executionOutputDir,
      }
    };

    console.log('Executing workflow via Temporal:', { workflowName, workflowId });

    // start the temporal workflow
    const handle = await client.workflow.start(workflowName, {
      taskQueue: 'sdlc-agents',
      workflowId: workflowId,
      args: [workflowInput],
    });

    // create execution record
    const execution = await WorkflowExecution.create({
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      temporal_workflow_id: handle.workflowId,
      temporal_run_id: handle.firstExecutionRunId,
      status: 'running',
      parameters: workflowInput,
      started_at: new Date().toISOString(),
    });

    // update workflow status to running
    await Workflow.update(req.params.id, {
      status: 'running',
      execution_metadata: {
        temporal_workflow_id: handle.workflowId,
        temporal_run_id: handle.firstExecutionRunId,
        started_at: new Date().toISOString(),
      },
    });

    res.json({
      success: true,
      data: {
        workflow_id: workflow.id,
        execution_id: execution.id,
        temporal_workflow_id: handle.workflowId,
        temporal_run_id: handle.firstExecutionRunId,
        temporal_ui_url: `http://localhost:8233/namespaces/default/workflows/${handle.workflowId}`,
        message: 'Workflow execution started successfully',
      },
    });
  } catch (error) {
    console.error('Error executing workflow:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/workflows/:id - Delete workflow
router.delete('/:id', authenticateToken, requirePermission(PERMISSIONS.WORKFLOW_DELETE), async (req, res) => {
  try {
    const workflow = await Workflow.delete(req.params.id);
    if (!workflow) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }
    res.json({ success: true, message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Error deleting workflow:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/workflows/templates/list - Get available workflow templates
router.get('/templates/list', authenticateToken, requirePermission(PERMISSIONS.TEMPLATE_VIEW), async (req, res) => {
  try {
    // Define templates inline to avoid Docker path issues
    const testTemplate = {
      id: 'test-workflow',
      name: 'Test Workflow',
      description: 'A simple test workflow',
      version: '1.0.0',
      steps: [
        {
          id: 'step-1',
          name: 'Test Step',
          type: 'task',
          config: { agentId: 'test-agent' }
        }
      ]
    };

    const sdlcTemplate = {
      id: 'sdlc-workflow',
      name: 'SDLC Workflow',
      description: 'Generate Epic and User Stories from BRD',
      version: '1.0.0',
      steps: [
        {
          id: 'generate-epic-stories',
          name: 'Generate Epic and Stories',
          type: 'agent',
          config: {
            agentId: 'epic-agent',
            agentName: 'Epic and User Stories Generator',
            timeout: '30 minutes',
            retryAttempts: 1
          }
        },
        {
          id: 'approval',
          name: 'Review and Approve Epic',
          type: 'approval',
          config: {
            approvalType: 'manual',
            timeout: '24h',
            message: 'Please review the generated epic and stories before creating JIRA tickets'
          }
        },
        {
          id: 'create-jira-tickets',
          name: 'Create JIRA Tickets',
          type: 'task',
          config: {
            taskType: 'function',
            functionName: 'createJiraTickets',
            timeout: '5 minutes',
            retryAttempts: 2
          }
        }
      ]
    };

    const completeSDLCTemplate = {
      id: 'complete-sdlc',
      name: 'Complete SDLC Workflow (Default)',
      description: 'Full end-to-end SDLC: Epic Generation → Approval → JIRA → Loop(Story Implementation → Unit Tests → PR → Approval) → CI/CD Pipeline',
      version: '1.0.0',
      steps: [
        {
          id: 'epic-generation',
          name: 'Generate Epic and Stories',
          type: 'agent',
          config: {
            agentId: 'epic-agent',
            agentName: 'Epic and User Stories Generator',
            timeout: '30 minutes',
            retryAttempts: 1
          }
        },
        {
          id: 'epic-approval',
          name: 'Manual Approval - Review Epic',
          type: 'approval',
          config: {
            approvalType: 'manual',
            timeout: '24h',
            message: 'Please review the generated epic and user stories before proceeding to JIRA creation'
          }
        },
        {
          id: 'create-jira',
          name: 'Create JIRA Tickets',
          type: 'agent',
          config: {
            agentId: 'jira-agent',
            agentName: 'JIRA Ticket Creator',
            timeout: '15 minutes',
            retryAttempts: 2
          }
        },
        {
          id: 'story-loop-start',
          name: 'For Each Story',
          type: 'loop',
          config: {
            loopType: 'forEach',
            iterateOver: 'stories',
            maxIterations: 100,
            continueOnError: false
          }
        },
        {
          id: 'implement-story',
          name: 'Implement Story',
          type: 'agent',
          config: {
            agentId: 'code-agent',
            agentName: 'Story Implementation Agent',
            timeout: '45 minutes',
            retryAttempts: 1
          }
        },
        {
          id: 'write-unit-tests',
          name: 'Write Unit Tests',
          type: 'agent',
          config: {
            agentId: 'test-generation-agent',
            agentName: 'Unit Test Generator',
            timeout: '30 minutes',
            retryAttempts: 1
          }
        },
        {
          id: 'run-unit-tests',
          name: 'Run Unit Tests',
          type: 'agent',
          config: {
            agentId: 'test-execution-agent',
            agentName: 'Test Executor',
            timeout: '20 minutes',
            retryAttempts: 3,
            parameters: {
              testCommand: 'npm test',
              maxRetries: 5
            }
          }
        },
        {
          id: 'raise-pr',
          name: 'Raise Pull Request',
          type: 'agent',
          config: {
            agentId: 'pr-agent',
            agentName: 'Pull Request Creator',
            timeout: '10 minutes',
            retryAttempts: 2
          }
        },
        {
          id: 'pr-approval',
          name: 'Manual Approval - Review PR',
          type: 'approval',
          config: {
            approvalType: 'manual',
            timeout: '48h',
            message: 'Please review the pull request for this story before moving to the next one'
          }
        },
        {
          id: 'story-loop-end',
          name: 'Next Story (Loop End)',
          type: 'loop',
          config: {
            loopType: 'end'
          }
        },
        {
          id: 'ci-cd-pipeline',
          name: 'Pipe to CI/CD',
          type: 'task',
          config: {
            taskType: 'activity',
            activityName: 'triggerCICDPipeline',
            timeout: '5 minutes',
            retryAttempts: 2,
            parameters: {
              pipelineType: 'merge-and-deploy',
              targetBranch: 'main'
            }
          }
        }
      ]
    };

    // Helper function to add START and END steps to template
    const addStartAndEndSteps = (template) => {
      const stepsWithStartAndEnd = [
        {
          id: 'workflow-start',
          name: 'Start',
          type: 'start',
          config: {}
        },
        ...template.steps,
        {
          id: 'workflow-end',
          name: 'Workflow Complete',
          type: 'end',
          config: {}
        }
      ];
      return { ...template, steps: stepsWithStartAndEnd };
    };

    // Return only executable Temporal templates with START and END steps
    const templates = [
      {
        id: completeSDLCTemplate.id,
        templateId: completeSDLCTemplate.id,
        name: completeSDLCTemplate.name,
        description: completeSDLCTemplate.description,
        version: completeSDLCTemplate.version,
        category: 'SDLC',
        executable: true,
        steps: completeSDLCTemplate.steps.map(step => ({
          id: step.id,
          name: step.name,
          type: step.type,
          config: step.config
        }))
      },
      {
        id: sdlcTemplate.id,
        templateId: sdlcTemplate.id,
        name: sdlcTemplate.name,
        description: sdlcTemplate.description,
        version: sdlcTemplate.version,
        category: 'SDLC',
        executable: true,
        steps: addStartAndEndSteps(sdlcTemplate).steps.map(step => ({
          id: step.id,
          name: step.name,
          type: step.type,
          config: step.config
        }))
      },
      {
        id: testTemplate.id,
        templateId: testTemplate.id,
        name: testTemplate.name,
        description: testTemplate.description,
        version: testTemplate.version,
        category: 'Test',
        executable: true,
        steps: addStartAndEndSteps(testTemplate).steps.map(step => ({
          id: step.id,
          name: step.name,
          type: step.type,
          config: step.config
        }))
      }
    ];

    res.json({ success: true, data: templates });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/workflows/templates/:templateId/execute - Execute a template directly
router.post('/templates/:templateId/execute', authenticateToken, requirePermission(PERMISSIONS.TEMPLATE_EXECUTE), async (req, res) => {
  try {
    const { templateId } = req.params;

    console.log(`\n🚀 Executing template: ${templateId}`);
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));

    let { brdPath, workspaceRoot, contextDirs, outputDir, gitRepoUrl, existingBrdPath, existingArchPath } = req.body;

    // TEMPORARY: Hardcode git parameters until frontend cache issue is resolved
    // TODO: Remove this once frontend properly sends these values
    if (!gitRepoUrl || gitRepoUrl === '') {
      console.log('⚠️  Using default git parameters (frontend not sending them)');
      gitRepoUrl = 'https://github.com/alokpandey/Inventory-system.git';
      existingBrdPath = 'docs';
      existingArchPath = 'docs';
    }

    console.log('📋 Final parameters:', { brdPath, workspaceRoot, contextDirs, outputDir, gitRepoUrl, existingBrdPath, existingArchPath });

    // Validate template exists
    const validTemplates = ['complete-sdlc', 'test-workflow', 'sdlc-workflow', 'test-epic-approval', 'full-sdlc'];
    if (!validTemplates.includes(templateId)) {
      return res.status(400).json({
        success: false,
        error: `Invalid template ID: ${templateId}. Valid templates: ${validTemplates.join(', ')}`
      });
    }

    // Create workflow execution ID
    const workflowId = `template-${templateId}-${Date.now()}`;

    // Get template name
    const templateNames = {
      'complete-sdlc': 'Complete SDLC Workflow (Default)',
      'test-workflow': 'Test Workflow',
      'sdlc-workflow': 'SDLC Workflow - Epic Generation with Approval',
      'test-epic-approval': 'Test Epic Generation with Approval',
      'full-sdlc': 'Full SDLC Workflow'
    };
    const workflowName = templateNames[templateId] || templateId;

    // Create Temporal client (with TLS support for Temporal Cloud)
    const { createTemporalClient } = require('../utils/temporalClient');
    const temporalClient = await createTemporalClient();

    // Use execution-specific output directory to avoid conflicts between concurrent executions
    const baseOutputDir = outputDir || 'sdlc-artifacts';
    const executionOutputDir = `${baseOutputDir}/executions/${workflowId}`;

    const workflowInput = {
      workflowId,
      templateId,
      parameters: {
        brdPath: brdPath || 'requirements/sample-brd.md',
        workspaceRoot: workspaceRoot || process.cwd(),
        contextDirs: contextDirs ? contextDirs.split(',').map(d => d.trim()) : [],
        outputDir: executionOutputDir,
        gitRepoUrl: gitRepoUrl || '',
        existingBrdPath: existingBrdPath || '',
        existingArchPath: existingArchPath || ''
      }
    };

    // Start Temporal workflow
    const handle = await temporalClient.workflow.start('templateWorkflow', {
      taskQueue: 'sdlc-agents',
      workflowId,
      args: [workflowInput]
    });

    console.log(`✅ Template workflow started: ${workflowId}`);

    // Create a placeholder workflow record for this template execution
    const placeholderWorkflowId = require('uuid').v4();
    await pool.query(
      `INSERT INTO workflows (id, name, description, status, nodes, edges, configuration, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        placeholderWorkflowId,
        `Template: ${workflowName}`,
        `Auto-generated workflow for template execution: ${templateId}`,
        'active',
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify({ templateId, isTemplateExecution: true }),
        'system'
      ]
    );

    // Create execution record in database
    const executionId = require('uuid').v4();
    await pool.query(
      `INSERT INTO workflow_executions
       (id, workflow_id, workflow_name, status, started_at, temporal_workflow_id, temporal_run_id, parameters, input_data)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8)`,
      [
        executionId,
        placeholderWorkflowId,
        workflowName,
        'running',
        workflowId,
        handle.firstExecutionRunId,
        JSON.stringify(workflowInput.parameters),
        JSON.stringify({})
      ]
    );

    console.log(`✅ Execution record created: ${executionId}`);

    res.json({
      success: true,
      data: {
        workflowId,
        runId: handle.firstExecutionRunId,
        templateId,
        executionId
      }
    });
  } catch (error) {
    console.error('Error executing template:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

