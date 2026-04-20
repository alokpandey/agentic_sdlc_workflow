/**
 * Workflow Template Registry
 */

import type { WorkflowTemplate } from '../types/workflowTemplate';
import { testTemplate } from './testTemplate';
import { sdlcTemplate } from './sdlcTemplate';
import { sdlcSimpleTemplate } from './sdlcSimpleTemplate';
import { completeSDLCTemplate } from './completeSDLCTemplate';

export const workflowTemplates: Record<string, WorkflowTemplate> = {
  'complete-sdlc': completeSDLCTemplate,
  'test-epic-approval': testTemplate,
  'full-sdlc': sdlcTemplate,
  'sdlc-workflow': sdlcSimpleTemplate,
};

export function getTemplate(templateId: string): WorkflowTemplate | undefined {
  return workflowTemplates[templateId];
}

export function listTemplates(): WorkflowTemplate[] {
  return Object.values(workflowTemplates);
}

