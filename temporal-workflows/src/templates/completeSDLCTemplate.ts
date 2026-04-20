/**
 * Complete SDLC Workflow Template - Default Template
 * 
 * Flow:
 * Start → Generate Epic & Stories → Manual Approval → Create JIRA → 
 * Loop(For Each Story) → Implement Story → Write Unit Tests → Run Unit Tests → 
 * Raise PR → Manual Approval → Next Story → Loop End → Pipe to CI/CD → End
 */

import type { WorkflowTemplate } from '../types/workflowTemplate';

export const completeSDLCTemplate: WorkflowTemplate = {
  id: 'complete-sdlc',
  name: 'Complete SDLC Workflow (Default)',
  description: 'Full end-to-end SDLC: Epic Generation → Approval → JIRA → Loop(Story Implementation → Unit Tests → PR → Approval) → CI/CD Pipeline',
  version: '1.0.0',
  steps: [
    {
      id: 'start',
      name: 'Start',
      type: 'start',
      config: {}
    },
    {
      id: 'epic-generation',
      name: 'Generate Epic and Stories',
      type: 'agent',
      config: {
        agentId: 'epic-agent',
        agentName: 'Epic and User Stories Generator',
        timeout: '30 minutes',
        retryAttempts: 1,
        parameters: {
          // BRD path, workspace, etc. will be provided at execution time
        }
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
        retryAttempts: 2,
        parameters: {
          // Epic and stories data from previous step
        }
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
        retryAttempts: 1,
        parameters: {
          // Current story ID from loop variable
        }
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
        retryAttempts: 1,
        parameters: {
          // Story implementation from previous step
        }
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
        retryAttempts: 2,
        parameters: {
          // Branch name and changes from implementation step
        }
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
    },
    {
      id: 'end',
      name: 'End',
      type: 'end',
      config: {}
    }
  ]
};

