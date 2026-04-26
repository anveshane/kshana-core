import { describe, expect, it } from 'vitest';
import {
  getDisconnectionCategory,
  getConnectionStatusMessage,
  shouldRemoveTrackedConnection,
} from '../../src/server/webSocketHandlerUtils.js';

describe('webSocketHandlerUtils', () => {
  it('returns a resumptive connected message for resumed sessions', () => {
    expect(getConnectionStatusMessage('remote', true)).toBe(
      'Session resumed (remote mode)',
    );
    expect(getConnectionStatusMessage('local', false)).toBe(
      'Session created (local mode)',
    );
  });

  it('only removes the currently tracked socket', () => {
    const activeSocket = {} as any;
    const staleSocket = {} as any;

    expect(shouldRemoveTrackedConnection(activeSocket, activeSocket)).toBe(true);
    expect(shouldRemoveTrackedConnection(activeSocket, staleSocket)).toBe(false);
    expect(shouldRemoveTrackedConnection(undefined, staleSocket)).toBe(false);
  });

  it('classifies disconnect reasons for resume and transport debugging', () => {
    expect(getDisconnectionCategory('heartbeat_timeout')).toBe(
      'heartbeat_timeout',
    );
    expect(
      getDisconnectionCategory(
        'socket_close:1000:session_resumed_elsewhere',
      ),
    ).toBe('replaced_by_resumed_socket');
    expect(getDisconnectionCategory('socket_close:1000')).toBe(
      'normal_client_disconnect',
    );
    expect(getDisconnectionCategory('socket_close:1006')).toBe(
      'abnormal_transport_close',
    );
  });
});
