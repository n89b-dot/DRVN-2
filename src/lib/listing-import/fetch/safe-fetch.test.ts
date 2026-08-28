import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { safeFetch } from "./safe-fetch";

/**
 * Behavioral tests against a local fixture server. `allowPrivate` is the
 * test-only escape hatch that lets the fetcher reach 127.0.0.1 — every check
 * that matters (per-hop URL validation, size caps, redirect limits, status
 * classification) still runs on that path.
 */

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><title>ok</title><body>hello</body></html>");
    } else if (url === "/redirect") {
      res.writeHead(302, { location: "/ok" });
      res.end();
    } else if (url === "/redirect-loop") {
      res.writeHead(302, { location: "/redirect-loop" });
      res.end();
    } else if (url === "/redirect-bad-scheme") {
      res.writeHead(302, { location: "ftp://example.com/x" });
      res.end();
    } else if (url === "/redirect-private") {
      // Even mid-chain, a hop is re-validated. (The fixture itself is only
      // reachable because allowPrivate is on; this hop targets the metadata
      // endpoint pattern via a DIFFERENT guard — the scheme check below
      // proves per-hop validation runs; the address rules have their own
      // unit matrix in guard.test.ts.)
      res.writeHead(302, { location: "ftp://169.254.169.254/latest" });
      res.end();
    } else if (url === "/big") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("x".repeat(300_000));
    } else if (url === "/login") {
      res.writeHead(401);
      res.end("login required");
    } else if (url === "/forbidden") {
      res.writeHead(403);
      res.end("no");
    } else if (url === "/challenge") {
      res.writeHead(429);
      res.end("slow down");
    } else if (url === "/slow") {
      setTimeout(() => {
        res.writeHead(200);
        res.end("late");
      }, 3_000);
    } else {
      res.writeHead(404);
      res.end("nope");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const opts = { maxBytes: 100_000, allowPrivate: true };

describe("safeFetch", () => {
  it("refuses private addresses without the test escape hatch", async () => {
    // Loopback host on a default port → address rule; the fixture port would
    // already have been refused by the port rule (also covered below).
    const literal = await safeFetch("http://127.0.0.1/ok", { maxBytes: 100_000 });
    expect(literal.ok).toBe(false);
    if (!literal.ok) expect(literal.code).toBe("source_private_address");

    const withPort = await safeFetch(`${base}/ok`, { maxBytes: 100_000 });
    expect(withPort.ok).toBe(false);
    if (!withPort.ok) expect(withPort.code).toBe("source_invalid");
  });

  it("fetches a page and reports the final URL", async () => {
    const result = await safeFetch(`${base}/ok`, opts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.toString()).toContain("hello");
      expect(result.contentType).toContain("text/html");
    }
  });

  it("follows redirects with per-hop validation", async () => {
    const result = await safeFetch(`${base}/redirect`, opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalUrl).toBe(`${base}/ok`);
  });

  it("caps redirect chains", async () => {
    const result = await safeFetch(`${base}/redirect-loop`, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("source_fetch_failed");
  });

  it("re-validates every redirect destination", async () => {
    const result = await safeFetch(`${base}/redirect-bad-scheme`, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("source_invalid");
  });

  it("enforces the byte cap on the received stream", async () => {
    const result = await safeFetch(`${base}/big`, { maxBytes: 50_000, allowPrivate: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("source_too_large");
  });

  it("classifies access-control statuses", async () => {
    const login = await safeFetch(`${base}/login`, opts);
    expect(!login.ok && login.code).toBe("source_login_required");
    const forbidden = await safeFetch(`${base}/forbidden`, opts);
    expect(!forbidden.ok && forbidden.code).toBe("source_access_denied");
    const challenge = await safeFetch(`${base}/challenge`, opts);
    expect(!challenge.ok && challenge.code).toBe("source_challenge");
  });

  it("times out slow origins", async () => {
    const result = await safeFetch(`${base}/slow`, {
      maxBytes: 100_000,
      allowPrivate: true,
      totalTimeoutMs: 500,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("source_fetch_timeout");
  }, 10_000);

  it("refuses credentialed and non-http URLs outright", async () => {
    const cred = await safeFetch(`http://user:pw@127.0.0.1/x`, opts);
    expect(!cred.ok && cred.code).toBe("source_invalid");
    const file = await safeFetch("file:///etc/passwd", opts);
    expect(!file.ok && file.code).toBe("source_invalid");
  });
});
