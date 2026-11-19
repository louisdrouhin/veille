/**
 * SSRF-hardened fetch for URLs that come from third-party content (favicons
 * found in a site's HTML). The worker runs inside the home network, so such
 * URLs must never reach private, loopback, link-local or reserved addresses.
 *
 * - http/https only;
 * - DNS resolved first, every address must be public (pre-check, clear errors);
 * - the socket itself goes through a guarded `lookup` (no DNS-rebinding window
 *   between the check and the connection);
 * - redirects followed manually (max 3), every hop re-checked;
 * - body size capped while streaming (see readLimited).
 *
 * Feed URLs are NOT fetched through this (they are typed by the owner).
 */
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

// ---------------------------------------------------------------------------
// Address policy
// ---------------------------------------------------------------------------

// Two separate lists: a single BlockList matches every IPv4 address against the
// IPv6 rule ::ffff:0:0/96 (IPv4-mapped), which would block the whole IPv4 space.
const blockedV4 = new net.BlockList();
const blockedV6 = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata…)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blockedV4.addSubnet(prefix, bits, "ipv4");
}
for (const [prefix, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::ffff:0:0", 96], // IPv4-mapped (would bypass the IPv4 rules)
  ["64:ff9b::", 96], // NAT64 (idem)
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blockedV6.addSubnet(prefix, bits, "ipv6");
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  return family === 4 ? !blockedV4.check(address, "ipv4") : !blockedV6.check(address, "ipv6");
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ResolvedAddress = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

/** Throws SsrfError unless the URL is http(s) and every address of its host is public. */
export async function assertPublicUrl(url: URL, resolve: Resolver = systemResolver): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Protocole refusé : ${url.protocol}`);
  }
  const host = bareHost(url);
  if (!host) throw new SsrfError("Hôte manquant");

  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new SsrfError(`Adresse non publique : ${host}`);
    return;
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new SsrfError(`Résolution DNS impossible : ${host}`);
  }
  if (addresses.length === 0) throw new SsrfError(`Aucune adresse pour ${host}`);
  const bad = addresses.find((a) => !isPublicAddress(a.address));
  if (bad) throw new SsrfError(`${host} pointe vers une adresse non publique : ${bad.address}`);
}

/**
 * `lookup` used by the socket itself: resolves, then refuses non-public
 * addresses. Closes the DNS-rebinding window left by the pre-check.
 */
function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0) {
      return callback(Object.assign(new SsrfError(`Connexion refusée vers ${bad?.address ?? hostname}`), { code: "ESSRF" }), []);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

let guardedAgent: Agent | undefined;
function agent(): Agent {
  guardedAgent ??= new Agent({ connect: { lookup: guardedLookup as never } });
  return guardedAgent;
}

/** Default transport: undici fetch through the guarded agent. */
const guardedFetch: typeof fetch = ((input: string | URL, init?: RequestInit) =>
  undiciFetch(input, { ...(init as object), dispatcher: agent() } as never)) as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export const MAX_REDIRECTS = 3;

export type SafeFetchOptions = {
  accept?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Injected in tests; defaults to the system resolver. */
  resolve?: Resolver;
  /** Injected in tests; defaults to undici fetch through the guarded agent. */
  fetchImpl?: typeof fetch;
};

/** GET with SSRF checks on the URL and on every redirect hop. Throws SsrfError when refused. */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const fetchImpl = opts.fetchImpl ?? guardedFetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfError(`URL invalide : ${input}`);
  }

  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url, opts.resolve);
    const res = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        ...(opts.accept ? { Accept: opts.accept } : {}),
        ...(opts.userAgent ? { "User-Agent": opts.userAgent } : {}),
      },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) throw new SsrfError(`Trop de redirections (max ${maxRedirects})`);
      try {
        url = new URL(location, url);
      } catch {
        throw new SsrfError(`Redirection invalide : ${location}`);
      }
      continue;
    }
    return res;
  }
}

/**
 * Reads a body but stops (and cancels the stream) as soon as it exceeds `max`
 * bytes: the limit is enforced during the download, not after.
 * Returns null when the body is too large.
 */
export async function readLimited(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
