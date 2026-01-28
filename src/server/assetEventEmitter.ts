/**
 * Global asset event emitter for notifying when assets are added.
 * This allows tools to emit asset events that can be caught by ConversationManager.
 */
import { EventEmitter } from 'events';

interface AssetAddedEvent {
  assetId: string;
  assetType: 'scene_image' | 'scene_video' | 'scene_infographic' | 'character_ref' | 'setting_ref' | 'final_video';
  placementNumber?: number;
  sceneNumber?: number;
  path: string;
  version: number;
  sessionId?: string;
}

class AssetEventEmitter extends EventEmitter {
  private currentSessionId: string | null = null;

  setCurrentSessionId(sessionId: string | null): void {
    this.currentSessionId = sessionId;
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  emitAssetAdded(event: AssetAddedEvent): void {
    // If no sessionId provided, use the current session
    const eventWithSession = {
      ...event,
      sessionId: event.sessionId ?? this.currentSessionId ?? undefined,
    };
    this.emit('asset_added', eventWithSession);
  }

  onAssetAdded(handler: (event: AssetAddedEvent) => void): void {
    this.on('asset_added', handler);
  }

  offAssetAdded(handler: (event: AssetAddedEvent) => void): void {
    this.off('asset_added', handler);
  }
}

export const assetEventEmitter = new AssetEventEmitter();
