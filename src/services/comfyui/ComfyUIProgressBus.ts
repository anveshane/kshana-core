/**
 * ComfyUI Progress Bus — singleton event bus for real-time generation progress.
 *
 * Decouples ComfyUI WebSocket progress from the agent/UI layer so that
 * any subscriber (e.g. GenericAgent) can relay updates to the browser.
 */

import { EventEmitter } from 'eventemitter3';

export interface ComfyProgressEvent {
  jobId: string;
  percentage: number;
  message: string;
  step?: number;
  maxSteps?: number;
  currentNode?: string;
  done: boolean;
}

export type ComfyProgressHandler = (event: ComfyProgressEvent) => void;

class ComfyUIProgressBus {
  private ee = new EventEmitter();
  private static EVENT = 'progress';

  emitProgress(event: ComfyProgressEvent): void {
    this.ee.emit(ComfyUIProgressBus.EVENT, event);
  }

  onProgress(handler: ComfyProgressHandler): void {
    this.ee.on(ComfyUIProgressBus.EVENT, handler);
  }

  offProgress(handler: ComfyProgressHandler): void {
    this.ee.off(ComfyUIProgressBus.EVENT, handler);
  }
}

export const comfyProgressBus = new ComfyUIProgressBus();
