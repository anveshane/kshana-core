/**
 * ComfyUI Progress Bus — singleton event bus for real-time generation progress.
 *
 * Decouples ComfyUI WebSocket progress from the agent/UI layer so that
 * any subscriber (e.g. GenericAgent) can relay updates to the browser.
 */

import { EventEmitter } from 'eventemitter3';
import * as fs from 'fs';
import * as path from 'path';

const BUS_LOG_PATH = path.join(process.cwd(), 'logs', 'debug.log');
function busLog(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(BUS_LOG_PATH, `[${timestamp}] ${message}\n`);
  } catch { /* ignore */ }
}

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
    const listenerCount = this.ee.listenerCount(ComfyUIProgressBus.EVENT);
    busLog(`[ProgressBus] emit: ${event.message} (${event.percentage}%) listeners=${listenerCount} done=${event.done}`);
    this.ee.emit(ComfyUIProgressBus.EVENT, event);
  }

  onProgress(handler: ComfyProgressHandler): void {
    this.ee.on(ComfyUIProgressBus.EVENT, handler);
    busLog(`[ProgressBus] subscriber added, total=${this.ee.listenerCount(ComfyUIProgressBus.EVENT)}`);
  }

  offProgress(handler: ComfyProgressHandler): void {
    this.ee.off(ComfyUIProgressBus.EVENT, handler);
    busLog(`[ProgressBus] subscriber removed, total=${this.ee.listenerCount(ComfyUIProgressBus.EVENT)}`);
  }
}

export const comfyProgressBus = new ComfyUIProgressBus();
