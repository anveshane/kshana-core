/**
 * ComfyUI Service Exports
 *
 * Provides ComfyUI integration for image and video generation.
 */

export { ComfyUIClient, type ComfyUIClientConfig, type ProgressCallback, type ImageInfo, type WSProgressInfo } from './ComfyUIClient.js';

export {
  loadWorkflowTemplate,
  parameterizeWorkflowByName,
  parameterizeCustomWorkflow,
  loadCustomWorkflowJson,
  parameterizeZImageWorkflow,
  parameterizeChromaRadianceWorkflow,
  workflowToPrompt,
  resolveSetGetNodes,
  aspectRatioToDimensions,
  type WorkflowTemplate,
  type WorkflowParams,
} from './WorkflowLoader.js';

export {
  WorkflowRegistry,
  WorkflowType,
  getRegistry,
  type WorkflowMetadata,
} from './WorkflowRegistry.js';

export { saveCustomWorkflow } from './WorkflowRegistry.js';

export {
  analyzeWorkflow,
  ensureApiFormat,
  isLiteGraphFormat,
  type WorkflowManifest,
  type ParameterMapping,
} from './WorkflowAnalyzer.js';

export { comfyProgressBus, type ComfyProgressEvent, type ComfyProgressHandler } from './ComfyUIProgressBus.js';
