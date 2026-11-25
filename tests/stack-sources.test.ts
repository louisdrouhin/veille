/**
 * Ma stack sources (docs/design/3.0 § 2.1) on real answers, trimmed (tests/fixtures/stack): NVD CVE
 * API 2.0, GitHub security advisories and releases, CERT-FR feeds and advisory JSON. Everything goes
 * through safe-fetch, errors never carry the URL (it names a product of the stack).
 */
import { describe, expect, it } from "vitest";
import { CERTFR_FEEDS, fetchCertfrAdvisory, mentionsExploitation, parseCertfrFeed, parseCertfrJson } from "@/lib/stack/sources/certfr";
import { fetchGithubAdvisories, fetchGithubReleases, githubRange, parseAdvisory } from "@/lib/stack/sources/github";
import { fetchNvd, nvdRanges, parseNvdCve, searchCpe, type NvdCve } from "@/lib/stack/sources/nvd";
import { SourceError } from "@/lib/stack/sources/types";
import { isAffected } from "@/lib/stack/versions";
import { fakeNet, fixture, json, nvdCve, nvdPage, xml } from "./helpers/stack-net";

const OPENSSH = "cpe:2.3:a:openbsd:openssh";
const regresshion = (JSON.parse(fixture("nvd-cve-2024-6387.json")) as { vulnerabilities: { cve: NvdCve }[] }).vulnerabilities[0]!.cve;

describe("NVD", () => {
  it("CVE-2024-6387: OpenSSH ranges only (not Debian's), score, NVD and vendor sources", () => {
    const v = parseNvdCve(regresshion, OPENSSH)!;
    expect(v).toMatchObject({ ref: "CVE-2024-6387", cveId: "CVE-2024-6387", cvss: 8.1, severity: "high", exploited: false });
    expect(v.ranges).toEqual([
      { src: "nvd", end: "4.4", endIncluding: false },
      { src: "nvd", start: "8.6", startIncluding: true, end: "9.8", endIncluding: true },
      { exact: "4.4", src: "nvd" },
      { exact: "8.5p1", src: "nvd" },
      { exact: "8.6", src: "nvd" },
    ]);
    expect(isAffected("9.6p1", v.ranges, "debian")).toBe(true);
    expect(isAffected("9.8p1", v.ranges, "debian")).toBe(false);
    expect(v.sources[0]).toEqual({ kind: "nvd", ref: "CVE-2024-6387", url: "https://nvd.nist.gov/vuln/detail/CVE-2024-6387" });
    expect(v.sources.find((s) => s.kind === "vendor")?.url).toBe("https://www.openssh.com/txt/release-9.8");
    expect(v.publishedAt.toISOString()).toBe("2024-07-01T13:15:06.467Z");
    expect(nvdRanges(regresshion, "cpe:2.3:o:debian:debian_linux")).toEqual([{ exact: "12.0", anyUpdate: true, src: "nvd" }]);
  });

  it("rejected, disputed, without range for the product, or with a bad id: skipped; KEV → exploitée", () => {
    expect(parseNvdCve({ ...regresshion, vulnStatus: "Rejected" }, OPENSSH)).toBeNull();
    expect(parseNvdCve({ ...regresshion, cveTags: [{ tags: ["disputed"] }] }, OPENSSH)).toBeNull();
    expect(parseNvdCve(regresshion, "cpe:2.3:a:openbsd:openbsd")).toBeNull();
    expect(parseNvdCve({ ...regresshion, id: "CVE-24-1" }, OPENSSH)).toBeNull();
    expect(parseNvdCve({ ...regresshion, cisaExploitAdd: "2026-11-10" }, OPENSSH)?.exploited).toBe(true);
  });

  it("asks by CPE, pages, incremental window (≤ 119 days), API key in a header, spaced without key", async () => {
    const pages = [0, 1].map((p) => ({ resultsPerPage: 1, startIndex: p, totalResults: 2, vulnerabilities: [{ cve: nvdCve(`CVE-2026-1000${p}`, OPENSSH, { versionEndExcluding: "9.8p1" }) }] }));
    const net = fakeNet([(u) => (u.hostname === "services.nvd.nist.gov" ? json(pages[Number(u.searchParams.get("startIndex"))]) : null)]);
    const waits: number[] = [];
    const now = new Date("2026-11-25T10:00:00Z");
    const res = await fetchNvd(OPENSSH, { ...net, sleep: async (ms) => void waits.push(ms) }, { since: new Date("2026-11-25T09:00:00Z"), now });
    expect(res.vulns.map((v) => v.ref)).toEqual(["CVE-2026-10000", "CVE-2026-10001"]);
    const first = new URL(net.calls[0]!.url);
    expect(first.pathname).toBe("/rest/json/cves/2.0");
    expect(first.searchParams.get("virtualMatchString")).toBe(OPENSSH);
    expect(first.searchParams.get("lastModStartDate")).toBe("2026-11-25T08:00:00.000+00:00");
    expect(first.searchParams.get("lastModEndDate")).toBe("2026-11-25T10:00:00.000+00:00");
    expect(waits).toEqual([6500]);
    expect(net.calls[0]!.headers.apikey).toBeUndefined();

    const keyed = fakeNet([() => nvdPage([])]);
    await fetchNvd(OPENSSH, { ...keyed, env: { NVD_API_KEY: "k-123" } }, { since: new Date("2026-01-01T00:00:00Z"), now });
    expect(keyed.calls[0]!.headers.apikey).toBe("k-123");
    expect(new URL(keyed.calls[0]!.url).searchParams.has("lastModStartDate")).toBe(false); // > 119 days: everything again
  });

  it("errors: a SourceError without the URL; an invalid CPE is never sent", async () => {
    const down = fakeNet([() => new Response("busy", { status: 503 })]);
    const err = await fetchNvd(OPENSSH, down).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).source).toBe("nvd");
    expect((err as Error).message).toBe("HTTP 503");
    expect(String(err)).not.toMatch(/openssh|nist/);
    const bad = fakeNet([]);
    await expect(fetchNvd("cpe:2.3:a:x:y&z=1", bad)).rejects.toThrow("CPE invalide");
    expect(bad.calls).toHaveLength(0);
  });

  it("CPE dictionary: one candidate per vendor:product, no hardware, deprecated skipped", async () => {
    const products = [
      { cpe: { cpeName: "cpe:2.3:a:jellyfin:jellyfin:10.8.0:*:*:*:*:*:*:*" } },
      { cpe: { cpeName: "cpe:2.3:a:jellyfin:jellyfin:10.9.1:*:*:*:*:*:*:*" } },
      { cpe: { cpeName: "cpe:2.3:a:jellyfin:jellyfin_media_player:1.9.0:*:*:*:*:*:*:*" } },
      { cpe: { cpeName: "cpe:2.3:h:jellyfin:box:1:*:*:*:*:*:*:*" } },
      { cpe: { cpeName: "cpe:2.3:a:old:jellyfin:1:*:*:*:*:*:*:*", deprecated: true } },
    ];
    const net = fakeNet([(u) => (u.pathname === "/rest/json/cpes/2.0" ? json({ products }) : null)]);
    expect(await searchCpe("jellyfin", net)).toEqual([
      { cpePrefix: "cpe:2.3:a:jellyfin:jellyfin", name: "Jellyfin", vendor: "Jellyfin" },
      { cpePrefix: "cpe:2.3:a:jellyfin:jellyfin_media_player", name: "Jellyfin Media Player", vendor: "Jellyfin" },
    ]);
    expect(new URL(net.calls[0]!.url).searchParams.get("keywordSearch")).toBe("jellyfin");
    expect(await searchCpe(" j ", net)).toEqual([]);
  });
});

describe("GitHub", () => {
  it("advisory ranges: « <= 1.37.3 » patched in 1.37.4, two bounds, exact, unreadable", () => {
    expect(githubRange("<= 1.37.3", "1.37.4")).toEqual({ src: "github", end: "1.37.3", endIncluding: true, fixed: "1.37.4" });
    expect(githubRange(">= 1.0.0, < 1.2.5", "1.2.5")).toEqual({ src: "github", start: "1.0.0", startIncluding: true, end: "1.2.5", endIncluding: false, fixed: "1.2.5" });
    expect(githubRange("= 2.0.0", null)).toEqual({ src: "github", exact: "2.0.0" });
    expect(githubRange("anything", null)).toBeNull();
  });

  it("vaultwarden advisories (real): GHSA ref when there is no CVE, CVSS v3 score, github.com link", async () => {
    const net = fakeNet([(u) => (u.pathname.endsWith("/security-advisories") ? new Response(fixture("github-advisories.json")) : null)]);
    const list = await fetchGithubAdvisories("dani-garcia/vaultwarden", net);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ ref: "GHSA-7jg8-8m5x-6j9r", cveId: null, cvss: 6.8, severity: "medium", exploited: false });
    expect(list[0]!.ranges).toEqual([{ src: "github", end: "1.37.3", endIncluding: true, fixed: "1.37.4" }]);
    expect(list[0]!.sources).toEqual([{ kind: "github", ref: "GHSA-7jg8-8m5x-6j9r", url: "https://github.com/dani-garcia/vaultwarden/security/advisories/GHSA-7jg8-8m5x-6j9r" }]);
    expect(net.calls[0]!.url).toBe("https://api.github.com/repos/dani-garcia/vaultwarden/security-advisories?state=published&per_page=100");
    expect(net.calls[0]!.headers.authorization).toBeUndefined();
  });

  it("withdrawn, unpublished, odd ids and links are dropped; a token goes in Authorization", async () => {
    const base = JSON.parse(fixture("github-advisories.json"))[0];
    expect(parseAdvisory({ ...base, withdrawn_at: "2026-11-01T00:00:00Z" })).toBeNull();
    expect(parseAdvisory({ ...base, state: "draft" })).toBeNull();
    expect(parseAdvisory({ ...base, ghsa_id: "GHSA-<script>" })).toBeNull();
    expect(parseAdvisory({ ...base, html_url: "javascript:alert(1)" })?.sources).toEqual([]);
    expect(parseAdvisory({ ...base, cve_id: "CVE-2026-12345" })?.ref).toBe("CVE-2026-12345");
    const net = fakeNet([() => json([])]);
    await fetchGithubAdvisories("dani-garcia/vaultwarden", { ...net, env: { GITHUB_TOKEN: "ghp_x" } });
    expect(net.calls[0]!.headers.authorization).toBe("Bearer ghp_x");
    expect(await fetchGithubAdvisories("../../etc", net)).toEqual([]);
    expect(net.calls).toHaveLength(1);
  });

  it("releases: stable tags newest first, « v » dropped, drafts and pre-releases skipped", async () => {
    const releases = [...JSON.parse(fixture("github-releases.json")), { tag_name: "v1.38.0-rc.1", prerelease: true }, { tag_name: "1.38.0", draft: true }, { tag_name: "v1.36.0" }];
    const net = fakeNet([() => json(releases)]);
    expect(await fetchGithubReleases("dani-garcia/vaultwarden", "semver", net)).toEqual(["1.37.5", "1.37.4", "1.37.3", "1.36.0"]);
  });
});

describe("CERT-FR", () => {
  it("feeds: references only, from the right feed", () => {
    expect(parseCertfrFeed(fixture("certfr-avis-feed.xml"), "avis").map((e) => e.ref)).toEqual(["CERTFR-2026-AVI-1547", "CERTFR-2026-AVI-1576", "CERTFR-2026-AVI-1577"]);
    const alerts = parseCertfrFeed(fixture("certfr-alerte-feed.xml"), "alerte");
    expect(alerts).toEqual([{ ref: "CERTFR-2024-ALE-009", kind: "alerte", feedTitle: "Vulnérabilité dans OpenSSH (01 juillet 2024)" }]);
    expect(parseCertfrFeed(fixture("certfr-avis-feed.xml"), "alerte")).toEqual([]);
    expect(CERTFR_FEEDS.avis).toBe("https://www.cert.cyber.gouv.fr/avis/feed/");
  });

  it("an alerte (real JSON): French title and summary in plain text, solution, CVEs, exploitée", () => {
    const entry = { ref: "CERTFR-2024-ALE-009", kind: "alerte" as const, feedTitle: "x" };
    const adv = parseCertfrJson(JSON.parse(fixture("certfr-CERTFR-2024-ALE-009.json")), entry)!;
    expect(adv).toMatchObject({ title: "Vulnérabilité dans OpenSSH", cves: ["CVE-2024-6387"], exploited: true, url: "https://www.cert.cyber.gouv.fr/alerte/CERTFR-2024-ALE-009/" });
    expect(adv.summary).toMatch(/^Le 1 juillet 2024, OpenSSH a publié un avis/);
    expect(adv.summary).not.toMatch(/\*/);
    expect(adv.solution).toBe("Se référer au bulletin de sécurité de l'éditeur pour l'obtention des correctifs (cf. section Documentation).");
    expect(parseCertfrJson(JSON.parse(fixture("certfr-CERTFR-2024-ALE-009.json")), { ...entry, ref: "CERTFR-2024-ALE-010" })).toBeNull();
  });

  it("an avis (real JSON) that says nothing of exploitation is not « exploitée »; the JSON URL is rebuilt from the ref", async () => {
    const net = fakeNet([(u) => (u.pathname === "/avis/CERTFR-2026-AVI-1547/json/" ? new Response(fixture("certfr-CERTFR-2026-AVI-1547.json")) : null)]);
    const adv = await fetchCertfrAdvisory({ ref: "CERTFR-2026-AVI-1547", kind: "avis", feedTitle: "x" }, net);
    expect(adv).toMatchObject({ title: "Multiples vulnérabilités dans Mitel MiCollab", exploited: false, cves: ["CVE-2026-133323"] });
    expect(net.calls[0]!.url).toBe("https://www.cert.cyber.gouv.fr/avis/CERTFR-2026-AVI-1547/json/");
    expect(await fetchCertfrAdvisory({ ref: "../../etc", kind: "avis", feedTitle: "x" }, net)).toBeNull();
  });

  it("exploitation wording, and its negations", () => {
    expect(mentionsExploitation("L'éditeur indique que la vulnérabilité CVE-2026-1 est activement exploitée.")).toBe(true);
    expect(mentionsExploitation("Ces vulnérabilités sont exploitées dans le cadre d'attaques ciblées.")).toBe(true);
    expect(mentionsExploitation("Le CERT-FR a connaissance d'une exploitation active.")).toBe(true);
    expect(mentionsExploitation("La vulnérabilité n'est pas exploitée à ce jour.")).toBe(false);
    expect(mentionsExploitation("Aucune preuve d'exploitation n'a été rapportée.")).toBe(false);
    expect(mentionsExploitation("Une exploitation permettrait un déni de service.")).toBe(false);
  });

  it("a feed down: SourceError certfr", async () => {
    const net = fakeNet([() => xml("<html>")]);
    const { fetchCertfrFeed } = await import("@/lib/stack/sources/certfr");
    expect(await fetchCertfrFeed("avis", net)).toEqual([]);
    const down = fakeNet([() => new Response("", { status: 502 })]);
    await expect(fetchCertfrFeed("avis", down)).rejects.toMatchObject({ source: "certfr", message: "HTTP 502" });
  });
});
