import type { WebSocket } from '@fastify/websocket';

export function getConnectionStatusMessage(
  mode: 'local' | 'remote',
  resumed: boolean,
): string {
  return resumed
    ? `Session resumed (${mode} mode)`
    : `Session created (${mode} mode)`;
}

export function shouldRemoveTrackedConnection(
  trackedSocket: WebSocket | undefined,
  closingSocket: WebSocket,
): boolean {
  return trackedSocket === closingSocket;
}

export function getDisconnectionCategory(reason: string): string {
  if (reason === 'heartbeat_timeout') {
    return 'heartbeat_timeout';
  }

  if (reason === 'server_shutdown') {
    return 'server_shutdown';
  }

  if (reason.includes('session_resumed_elsewhere')) {
    return 'replaced_by_resumed_socket';
  }

  if (reason.startsWith('socket_close:1000')) {
    return 'normal_client_disconnect';
  }

  if (reason.startsWith('socket_close:1001')) {
    return 'server_shutdown';
  }

  if (reason.startsWith('socket_close:')) {
    return 'abnormal_transport_close';
  }

  return 'unknown';
}
