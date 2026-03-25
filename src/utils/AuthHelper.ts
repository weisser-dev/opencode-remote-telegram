import { getAuthForPort } from '../services/ServeManager.js';

/**
 * Returns Basic Auth headers for a specific opencode serve port.
 * Each serve instance has its own randomly generated credentials —
 * no static env vars needed.
 */
export function getAuthHeaders(port: number): Record<string, string> {
  const creds = getAuthForPort(port);
  if (!creds) return {};
  const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}
