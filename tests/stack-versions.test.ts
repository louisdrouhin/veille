/**
 * Ma stack, version comparison per scheme (docs/design/3.0 § 2.2): semver, Debian / OpenSSH, vendor.
 * Never a string comparison, and a version that cannot be read is never « à jour ».
 */
import { describe, expect, it } from "vitest";
import { compareVersions, isAffected, nearestFix, nvdVersion, parseVersion, sortVersionsDesc } from "@/lib/stack/versions";

const lt = (a: string, b: string, scheme: "semver" | "debian" | "vendor") => {
  expect(compareVersions(a, b, scheme), `${a} < ${b}`).toBe(-1);
  expect(compareVersions(b, a, scheme), `${b} > ${a}`).toBe(1);
};

describe("semver", () => {
  it("numbers, not text: 1.10.0 > 1.9.2, 1.32.0 > 1.4.10", () => {
    lt("1.9.2", "1.10.0", "semver");
    lt("1.4.10", "1.32.0", "semver");
    lt("1.37.3", "1.37.4", "semver");
  });

  it("pre-releases before the release, build metadata ignored, « v » prefix and trailing zeros", () => {
    lt("1.32.0-rc.1", "1.32.0", "semver");
    lt("1.32.0-alpha.2", "1.32.0-beta.1", "semver");
    lt("1.32.0-beta.9", "1.32.0-rc.1", "semver");
    expect(compareVersions("v1.32.0", "1.32.0", "semver")).toBe(0);
    expect(compareVersions("1.32.0+build.7", "1.32.0", "semver")).toBe(0);
    expect(compareVersions("2024.11", "2024.11.0", "semver")).toBe(0);
  });
});

describe("Debian / OpenSSH", () => {
  it("9.4p1 is after 9.4 and before 9.5; 9.10p1 after 9.9p1", () => {
    lt("9.4", "9.4p1", "debian");
    lt("9.4p1", "9.4p2", "debian");
    lt("9.4p1", "9.5p1", "debian");
    lt("9.9p1", "9.10p1", "debian");
  });

  it("Debian packages: epoch first, then upstream, then revision; « ~ » before anything", () => {
    lt("9.2p1-2+deb12u3", "1:9.2p1-2", "debian");
    lt("1:9.2p1-2+deb12u2", "1:9.2p1-2+deb12u3", "debian");
    lt("1:9.2p1-2", "1:9.2p1-2+deb12u1", "debian");
    lt("1.0~rc1", "1.0", "debian");
    expect(parseVersion("1:9.2p1-2+deb12u3", "debian")).toMatchObject({ epoch: 1 });
  });
});

describe("vendor schemes", () => {
  it("« 8.0 U2 »: updates after the release; NVD's « update_2 » is the same version", () => {
    lt("8.0", "8.0 U1", "vendor");
    lt("8.0 U1", "8.0 U2", "vendor");
    lt("8.0 U2", "8.0.1", "vendor");
    expect(compareVersions("8.0 U2", "8.0 update_2", "vendor")).toBe(0);
    expect(compareVersions("8.0u2", "8.0 U2", "vendor")).toBe(0);
  });

  it("years and builds: 2022 < 2025, 10.0.20348.2340 < 10.0.20348.2700, DSM 7.2.2-72806", () => {
    lt("2022", "2025", "vendor");
    lt("10.0.20348.2340", "10.0.20348.2700", "vendor");
    lt("7.2.1-69057", "7.2.2-72806", "vendor");
    lt("7.0.12", "7.0.16", "vendor");
  });
});

describe("unreadable versions: null, never « à jour »", () => {
  it("no leading number, unknown word, wildcard, too long, odd characters", () => {
    for (const v of ["", "latest", "stable", "1.2.x", "v", "abc1.0", "1.0 (build)", "x".repeat(70), "1.0;rm", "9.8\tp1", "1.0\n2.0"]) {
      expect(parseVersion(v, "vendor"), JSON.stringify(v)).toBeNull();
    }
    expect(parseVersion("1:2.0", "semver")).toBeNull(); // an epoch only means something for Debian
    expect(compareVersions("latest", "1.0", "semver")).toBeNull();
    expect(isAffected("latest", [{ end: "2.0" }], "semver")).toBeNull();
  });
});

describe("affected ranges", () => {
  // CVE-2024-6387 (regreSSHion) as NVD describes it for OpenSSH.
  const regresshion = [
    { end: "4.4", endIncluding: false },
    { start: "8.6", startIncluding: true, end: "9.8", endIncluding: true },
    { exact: "4.4" },
    { exact: "8.5p1" },
    { exact: "8.6" },
  ];

  it("CVE-2024-6387: 8.5p1 to 9.7p1 and 9.8 touched, 9.8p1 (the fix) and 8.4p1 not", () => {
    for (const v of ["8.5p1", "8.6p1", "9.3p2", "9.7p1", "9.8", "4.3p2", "4.4"]) expect(isAffected(v, regresshion, "debian"), v).toBe(true);
    for (const v of ["9.8p1", "9.9p1", "8.4p1", "4.4p1"]) expect(isAffected(v, regresshion, "debian"), v).toBe(false);
  });

  it("bounds: including or not; no bound at all = every version", () => {
    expect(isAffected("1.37.3", [{ end: "1.37.3", endIncluding: true }], "semver")).toBe(true);
    expect(isAffected("1.37.3", [{ end: "1.37.3", endIncluding: false }], "semver")).toBe(false);
    expect(isAffected("1.0.0", [{ start: "1.0.0", startIncluding: false, end: "2.0.0" }], "semver")).toBe(false);
    expect(isAffected("1.0.1", [{ start: "1.0.0", startIncluding: false, end: "2.0.0" }], "semver")).toBe(true);
    expect(isAffected("3.1.4", [{}], "semver")).toBe(true);
    expect(isAffected("3.1.4", [], "semver")).toBe(false);
  });

  it("an exact version with any update (« 8.0 » + « * »), and an unreadable bound never matches", () => {
    expect(isAffected("8.0 U2", [{ exact: "8.0", anyUpdate: true }], "vendor")).toBe(true);
    expect(isAffected("8.0 U2", [{ exact: "8.0" }], "vendor")).toBe(false);
    expect(isAffected("8.0.1", [{ exact: "8.0", anyUpdate: true }], "vendor")).toBe(false);
    expect(isAffected("1.0", [{ end: "latest" }], "vendor")).toBe(false);
  });
});

describe("fixes and releases", () => {
  it("nearest fix: the lowest fixed version above mine, in my branch when there is one", () => {
    expect(nearestFix("7.0.12", ["7.6.1", "6.4.9", "7.0.16"], "vendor")).toBe("7.0.16");
    expect(nearestFix("7.0.12", ["8.0.1", "6.4.9"], "vendor")).toBe("8.0.1");
    expect(nearestFix("29.0.4", ["30.0.2", "29.0.9", "28.0.12"], "semver")).toBe("29.0.9");
    expect(nearestFix("9.6p1", ["9.8p1"], "debian")).toBe("9.8p1");
    expect(nearestFix("9.9p1", ["9.8p1"], "debian")).toBeNull();
    expect(nearestFix("latest", ["1.0"], "semver")).toBeNull();
  });

  it("sorts newest first, drops unreadable; NVD version + update → one string", () => {
    expect(sortVersionsDesc(["1.9.0", "1.37.5", "1.10.2", "nightly"], "semver")).toEqual(["1.37.5", "1.10.2", "1.9.0"]);
    expect(nvdVersion("9.4", "p1")).toBe("9.4p1");
    expect(nvdVersion("8.0", "update_2")).toBe("8.0 U2");
    expect(nvdVersion("4.4", "-")).toBe("4.4");
    expect(nvdVersion("4.4", "*")).toBe("4.4");
  });
});
