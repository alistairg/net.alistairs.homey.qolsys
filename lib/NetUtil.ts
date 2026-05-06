/**
 * Strip a `:port` suffix from a host returned by Homey APIs while
 * leaving IPv6 addresses (which contain colons) intact.
 *
 * Homey's homey.cloud.getLocalAddress() returns values like
 * "192.168.1.50:8080" (IPv4 with port) or sometimes plain hostnames.
 * The naive `replace(/:.*$/, '')` mangles IPv6 by stripping after the
 * first colon. This helper:
 *   - returns IPv6 addresses unchanged
 *   - returns IPv4 with port stripped to just the IPv4 part
 *   - returns plain hostnames / IPv4-without-port unchanged
 */
export function stripPort(host: string): string {
  if (!host) return host;
  // IPv6 detection — at least two colons or wrapped in brackets.
  if (host.startsWith('[') || (host.match(/:/g) || []).length > 1) {
    // Strip enclosing brackets if present, otherwise return as-is.
    return host.replace(/^\[|\]$/g, '');
  }
  // IPv4 with optional port: "1.2.3.4" or "1.2.3.4:8080"
  const ipv4WithPort = host.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?$/);
  if (ipv4WithPort) return ipv4WithPort[1];
  // Hostname with optional port: "homey.local:8080"
  const hostWithPort = host.match(/^([^:\s]+)(?::\d+)?$/);
  if (hostWithPort) return hostWithPort[1];
  return host;
}
