import { randomUUID } from 'crypto';

export interface DesktopSessionCapabilities {
  desktopRemotion: boolean;
  desktopAssembly: boolean;
  desktopVersion?: string;
}

export interface TimelineAssemblyItem {
  type: 'image' | 'video' | 'placeholder';
  path: string;
  duration: number;
  startTime: number;
  endTime: number;
  sourceOffsetSeconds?: number;
  label?: string;
}

export interface TimelineAssemblyOverlayItem {
  path: string;
  duration: number;
  startTime: number;
  endTime: number;
  label?: string;
}

export interface TimelineAssemblyTextOverlayCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: Array<{
    text: string;
    startTime: number;
    endTime: number;
    charStart: number;
    charEnd: number;
  }>;
}

export interface TimelineAssemblyPromptOverlayCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface TimelineAssemblyRequest {
  requestId: string;
  projectDir: string;
  timelineItems: TimelineAssemblyItem[];
  audioPath?: string;
  overlayItems?: TimelineAssemblyOverlayItem[];
  textOverlayCues?: TimelineAssemblyTextOverlayCue[];
  promptOverlayCues?: TimelineAssemblyPromptOverlayCue[];
  outputIntent: 'final_video';
  outputName: string;
}

export interface TimelineAssemblyProgress {
  requestId: string;
  progress?: number;
  stage?: 'preparing' | 'rendering' | 'persisting' | 'finalizing';
  message?: string;
}

export interface TimelineAssemblyResult {
  requestId: string;
  status: 'completed' | 'failed';
  outputPath?: string;
  duration?: number;
  artifactId?: string;
  manifestRelativePath?: string;
  error?: string;
}

type SessionSender = (type: 'timeline_assembly_request', data: TimelineAssemblyRequest) => void;

interface PendingRequest {
  sessionId: string;
  resolve: (result: TimelineAssemblyResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

class DesktopAssemblyBroker {
  private readonly capabilities = new Map<string, DesktopSessionCapabilities>();

  private readonly senders = new Map<string, SessionSender>();

  private readonly pending = new Map<string, PendingRequest>();

  setCapabilities(sessionId: string, capabilities: DesktopSessionCapabilities): void {
    this.capabilities.set(sessionId, capabilities);
  }

  clearCapabilities(sessionId: string): void {
    this.capabilities.delete(sessionId);
  }

  getCapabilities(sessionId: string): DesktopSessionCapabilities | undefined {
    return this.capabilities.get(sessionId);
  }

  canAssemble(sessionId: string): boolean {
    const caps = this.capabilities.get(sessionId);
    return Boolean(caps?.desktopAssembly && this.senders.has(sessionId));
  }

  attachSender(sessionId: string, sender: SessionSender): void {
    this.senders.set(sessionId, sender);
  }

  detachSession(sessionId: string, reason = 'Desktop session disconnected.'): void {
    this.senders.delete(sessionId);
    this.capabilities.delete(sessionId);

    for (const [requestId, pending] of this.pending) {
      if (pending.sessionId !== sessionId) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
      pending.reject(new Error(reason));
    }
  }

  async requestTimelineAssembly(
    sessionId: string,
    request: Omit<TimelineAssemblyRequest, 'requestId'> & { requestId?: string },
    options?: { timeoutMs?: number },
  ): Promise<TimelineAssemblyResult> {
    const sender = this.senders.get(sessionId);
    const capabilities = this.capabilities.get(sessionId);
    if (!sender || !capabilities?.desktopAssembly) {
      throw new Error('Desktop timeline assembly is not available for this session.');
    }

    const requestId = request.requestId?.trim() || randomUUID();
    const payload: TimelineAssemblyRequest = {
      ...request,
      requestId,
    };

    return new Promise<TimelineAssemblyResult>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? 10 * 60_000;
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timed out waiting for desktop timeline assembly result (${timeoutMs}ms).`));
      }, timeoutMs);

      this.pending.set(requestId, {
        sessionId,
        resolve,
        reject,
        timeout,
      });

      try {
        sender('timeline_assembly_request', payload);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  handleTimelineAssemblyProgress(_sessionId: string, _progress: TimelineAssemblyProgress): void {
    // Reserved for server-side logging/streaming if needed later.
  }

  handleTimelineAssemblyResult(sessionId: string, result: TimelineAssemblyResult): void {
    const pending = this.pending.get(result.requestId);
    if (!pending || pending.sessionId !== sessionId) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(result.requestId);
    pending.resolve(result);
  }
}

export const desktopAssemblyBroker = new DesktopAssemblyBroker();
