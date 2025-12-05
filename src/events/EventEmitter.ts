/**
 * Type-safe event emitter for agent events.
 */
import { EventEmitter as EventEmitter3 } from 'eventemitter3';
import type { AgentEvent, AgentEventType } from './events.js';

/**
 * Extract event data type from event type string.
 */
type EventDataByType<T extends AgentEventType> = Extract<AgentEvent, { type: T }>;

/**
 * Event handler function type.
 */
type EventHandler<T extends AgentEventType> = (event: EventDataByType<T>) => void;

/**
 * Type-safe event emitter for agent events.
 */
export class TypedEventEmitter {
  private emitter = new EventEmitter3();

  /**
   * Subscribe to an event type.
   */
  on<T extends AgentEventType>(type: T, handler: EventHandler<T>): this {
    this.emitter.on(type, handler as (event: AgentEvent) => void);
    return this;
  }

  /**
   * Subscribe to an event type once.
   */
  once<T extends AgentEventType>(type: T, handler: EventHandler<T>): this {
    this.emitter.once(type, handler as (event: AgentEvent) => void);
    return this;
  }

  /**
   * Unsubscribe from an event type.
   */
  off<T extends AgentEventType>(type: T, handler?: EventHandler<T>): this {
    this.emitter.off(type, handler as ((event: AgentEvent) => void) | undefined);
    return this;
  }

  /**
   * Emit an event.
   */
  emit<T extends AgentEventType>(event: EventDataByType<T>): boolean {
    return this.emitter.emit(event.type, event);
  }

  /**
   * Remove all listeners.
   */
  removeAllListeners(type?: AgentEventType): this {
    this.emitter.removeAllListeners(type);
    return this;
  }
}
