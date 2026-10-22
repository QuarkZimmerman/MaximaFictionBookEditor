/**
 * Address helpers of the AI assistant (feature 005; rpc-api Definitions "Address", "Host" and
 * "Local address"; data-model §0). Pure functions on the textual form of a service address, so
 * the UI applies the one rule the core applies for its agreement gate:
 *
 *  - a *local* address is one whose host - ASCII lower-cased, IPv6 brackets removed - is
 *    `localhost`, an IPv4 literal in `127.0.0.0/8` or the IPv6 literal `::1`, and nothing else:
 *    `.localhost` names, `0.0.0.0`, `::`, LAN names and LAN addresses are *hosted* (FR-021: the
 *    first-use notice is shown for hosted services only);
 *  - a *plain* address has the scheme `http` (FR-003: a warning when plain and not local);
 *  - the *host* is the authority of the address without user information, `host` or
 *    `host:port` as written - the only part of an address that reaches the log or the test
 *    record;
 *  - the *agreement key* of a target is the entry's `id` for a free service and
 *    `custom:<address as stored>` for the custom one (data-model §2.3).
 *
 * This module is part of the main bundle (vite.config.ts lists it among the static modules of
 * `src/ai/`): the settings page needs it while the assistant is off or disabled.
 */

/** The authority of `address` (`[userinfo@]host[:port]`), or `''` when it has no `scheme://`. */
function authorityOf(address: string): string {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(address.trim());
  return match ? match[1]! : '';
}

/**
 * `host` or `host:port` as written, without user information; `''` for an address without a
 * `scheme://` authority.
 */
export function hostOf(address: string): string {
  const authority = authorityOf(address);
  const at = authority.lastIndexOf('@');
  return at >= 0 ? authority.slice(at + 1) : authority;
}

/** The host name alone: brackets of an IPv6 literal removed, the port removed, ASCII lower-cased. */
export function hostNameOf(address: string): string {
  const host = hostOf(address);
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    return (close >= 0 ? host.slice(1, close) : host.slice(1)).toLowerCase();
  }
  const colon = host.lastIndexOf(':');
  // One colon with digits after it is a port; several colons are an unbracketed IPv6 literal.
  if (colon >= 0 && host.indexOf(':') === colon && /^\d*$/.test(host.slice(colon + 1))) {
    return host.slice(0, colon).toLowerCase();
  }
  return host.toLowerCase();
}

/** An IPv4 literal (four decimal octets, each 0-255) in `127.0.0.0/8`. */
function isLoopbackIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1, 5).map(Number);
  return octets[0] === 127 && octets.every((octet) => octet <= 255);
}

/**
 * True when the address is on the user's own computer by the textual rule: the host is
 * `localhost` (ASCII case-insensitive), an IPv4 literal in `127.0.0.0/8` or the IPv6 literal
 * `::1`. Everything else - `.localhost` names, `0.0.0.0`, `::`, LAN names and addresses, an
 * address without a host - is hosted.
 */
export function isLocalAddress(address: string): boolean {
  const host = hostNameOf(address);
  return host === 'localhost' || host === '::1' || isLoopbackIpv4(host);
}

/** True when the address is hosted (not local): the notice and the agreement apply (FR-021). */
export function isHostedAddress(address: string): boolean {
  return !isLocalAddress(address);
}

/** True when the scheme is `http` (case-insensitive) - an unencrypted transport. */
export function isPlainHttp(address: string): boolean {
  return /^http:\/\//i.test(address.trim());
}

/** True when the address is plain `http` and not local (FR-003, FR-021: the unencrypted warning). */
export function needsUnencryptedWarning(address: string): boolean {
  return isPlainHttp(address) && !isLocalAddress(address);
}

/** The address without its trailing `/` characters (removed on use, never an error - data-model §1.5). */
export function stripTrailingSlash(address: string): string {
  return address.replace(/\/+$/, '');
}

/** What an agreement key is derived from: a free entry by id, the custom target by its stored address. */
export type AgreementTarget = { kind: 'free'; id: string } | { kind: 'custom'; address: string };

/**
 * The key an agreement is stored under (data-model §2.3): the entry's `id` for a free target,
 * `custom:` + the address as stored (not normalised) for the custom one.
 */
export function agreementKey(target: AgreementTarget): string {
  return target.kind === 'free' ? target.id : `custom:${target.address}`;
}
