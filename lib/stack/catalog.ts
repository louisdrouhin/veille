/**
 * Catalog of common homelab and MSP software (docs/design/3.0 § 2), matched automatically.
 * CPE prefixes checked against the NVD API (nov. 2026, number of CVEs > 0); products without a CPE
 * (Immich) are followed through GitHub only. Upserted by key at every start (scripts/migrate.ts):
 * editing an entry here updates it in place, nothing is ever deleted (stack items point to it).
 * Anything else: the NVD CPE dictionary search of the « Ajouter » sheet (lib/stack/sources/nvd.ts).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { products, type VersionScheme } from "@/lib/db/schema";

export type CatalogEntry = {
  key: string;
  name: string;
  vendor: string;
  cpePrefix: string | null;
  githubRepo: string | null;
  versionScheme: VersionScheme;
  versionHint?: string;
};

const WINDOWS_HINT = "Numéro de build complet (winver ou « ver »), ex. 10.0.20348.2700";

export const CATALOG: readonly CatalogEntry[] = [
  { key: "proxmox-ve", name: "Proxmox VE", vendor: "Proxmox", cpePrefix: "cpe:2.3:a:proxmox:virtual_environment", githubRepo: null, versionScheme: "vendor", versionHint: "pveversion, ex. 8.2.4" },
  { key: "proxmox-backup-server", name: "Proxmox Backup Server", vendor: "Proxmox", cpePrefix: "cpe:2.3:a:proxmox:backup_server", githubRepo: null, versionScheme: "vendor", versionHint: "proxmox-backup-manager versions, ex. 3.2.7" },
  { key: "vaultwarden", name: "Vaultwarden", vendor: "Vaultwarden", cpePrefix: "cpe:2.3:a:dani-garcia:vaultwarden", githubRepo: "dani-garcia/vaultwarden", versionScheme: "semver" },
  { key: "immich", name: "Immich", vendor: "Immich", cpePrefix: null, githubRepo: "immich-app/immich", versionScheme: "semver" },
  { key: "nginx-proxy-manager", name: "Nginx Proxy Manager", vendor: "jc21", cpePrefix: "cpe:2.3:a:jc21:nginx_proxy_manager", githubRepo: "NginxProxyManager/nginx-proxy-manager", versionScheme: "semver" },
  { key: "jellyfin", name: "Jellyfin", vendor: "Jellyfin", cpePrefix: "cpe:2.3:a:jellyfin:jellyfin", githubRepo: "jellyfin/jellyfin", versionScheme: "semver" },
  { key: "pi-hole", name: "Pi-hole", vendor: "Pi-hole", cpePrefix: "cpe:2.3:a:pi-hole:pi-hole", githubRepo: "pi-hole/pi-hole", versionScheme: "semver", versionHint: "Version de Core (pihole -v)" },
  { key: "pfsense", name: "pfSense", vendor: "Netgate", cpePrefix: "cpe:2.3:a:netgate:pfsense", githubRepo: null, versionScheme: "vendor", versionHint: "ex. 2.7.2 (CE) ou 24.11 (Plus)" },
  { key: "opnsense", name: "OPNsense", vendor: "Deciso", cpePrefix: "cpe:2.3:a:opnsense:opnsense", githubRepo: null, versionScheme: "vendor", versionHint: "ex. 24.7.1" },
  { key: "uptime-kuma", name: "Uptime Kuma", vendor: "Louis Lam", cpePrefix: "cpe:2.3:a:uptime.kuma:uptime_kuma", githubRepo: "louislam/uptime-kuma", versionScheme: "semver" },
  { key: "openssh", name: "OpenSSH", vendor: "OpenBSD", cpePrefix: "cpe:2.3:a:openbsd:openssh", githubRepo: null, versionScheme: "debian", versionHint: "ssh -V, ex. 9.4p1 (version amont, pas celle du paquet)" },
  { key: "nextcloud", name: "Nextcloud", vendor: "Nextcloud", cpePrefix: "cpe:2.3:a:nextcloud:nextcloud_server", githubRepo: "nextcloud/server", versionScheme: "semver" },
  { key: "home-assistant", name: "Home Assistant", vendor: "Home Assistant", cpePrefix: "cpe:2.3:a:home-assistant:home-assistant", githubRepo: "home-assistant/core", versionScheme: "semver" },
  { key: "portainer", name: "Portainer", vendor: "Portainer", cpePrefix: "cpe:2.3:a:portainer:portainer", githubRepo: "portainer/portainer", versionScheme: "semver" },
  { key: "traefik", name: "Traefik", vendor: "Traefik Labs", cpePrefix: "cpe:2.3:a:traefik:traefik", githubRepo: "traefik/traefik", versionScheme: "semver" },
  { key: "gitea", name: "Gitea", vendor: "Gitea", cpePrefix: "cpe:2.3:a:gitea:gitea", githubRepo: "go-gitea/gitea", versionScheme: "semver" },
  { key: "grafana", name: "Grafana", vendor: "Grafana Labs", cpePrefix: "cpe:2.3:a:grafana:grafana", githubRepo: "grafana/grafana", versionScheme: "semver" },
  { key: "synology-dsm", name: "Synology DSM", vendor: "Synology", cpePrefix: "cpe:2.3:o:synology:diskstation_manager", githubRepo: null, versionScheme: "vendor", versionHint: "ex. 7.2.2" },
  { key: "fortios", name: "FortiOS", vendor: "Fortinet", cpePrefix: "cpe:2.3:o:fortinet:fortios", githubRepo: null, versionScheme: "vendor", versionHint: "ex. 7.0.12" },
  { key: "vmware-esxi", name: "VMware ESXi", vendor: "Broadcom (VMware)", cpePrefix: "cpe:2.3:o:vmware:esxi", githubRepo: null, versionScheme: "vendor", versionHint: "ex. 8.0 U2" },
  { key: "windows-server-2019", name: "Windows Server 2019", vendor: "Microsoft", cpePrefix: "cpe:2.3:o:microsoft:windows_server_2019", githubRepo: null, versionScheme: "vendor", versionHint: WINDOWS_HINT.replace("20348.2700", "17763.6414") },
  { key: "windows-server-2022", name: "Windows Server 2022", vendor: "Microsoft", cpePrefix: "cpe:2.3:o:microsoft:windows_server_2022", githubRepo: null, versionScheme: "vendor", versionHint: WINDOWS_HINT },
  { key: "windows-server-2025", name: "Windows Server 2025", vendor: "Microsoft", cpePrefix: "cpe:2.3:o:microsoft:windows_server_2025", githubRepo: null, versionScheme: "vendor", versionHint: WINDOWS_HINT.replace("20348.2700", "26100.2314") },
];

/** Inserts the catalog, or updates its entries in place (sync state untouched). */
export async function syncCatalog(db: Db): Promise<void> {
  // A product found in the NVD dictionary before it joined the catalog becomes that entry.
  for (const c of CATALOG) {
    if (c.cpePrefix) await db.update(products).set({ key: c.key }).where(and(eq(products.cpePrefix, c.cpePrefix), isNull(products.key)));
  }
  await db
    .insert(products)
    .values(CATALOG.map((c) => ({ ...c, versionHint: c.versionHint ?? null })))
    .onConflictDoUpdate({
      target: products.key,
      set: {
        name: sql`excluded.name`,
        vendor: sql`excluded.vendor`,
        cpePrefix: sql`excluded.cpe_prefix`,
        githubRepo: sql`excluded.github_repo`,
        versionScheme: sql`excluded.version_scheme`,
        versionHint: sql`excluded.version_hint`,
      },
    });
}
