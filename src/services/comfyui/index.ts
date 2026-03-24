/**
 * ComfyUI Service Exports
 *
 * Provides ComfyUI integration for image and video generation.
 */

export {
  ComfyUIClient,
  type ComfyUIClientConfig,
  type ProgressCallback,
  type ImageInfo,
  type DownloadedOutput,
  type WSProgressInfo,
} from './ComfyUIClient.js';

export {
  loadWorkflowTemplate,
  parameterizeWorkflowByName,
  parameterizeZImageWorkflow,
  parameterizeChromaRadianceWorkflow,
  workflowToPrompt,
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

export { comfyProgressBus, type ComfyProgressEvent, type ComfyProgressHandler } from './ComfyUIProgressBus.js';
