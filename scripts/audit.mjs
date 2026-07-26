#!/usr/bin/env node
/**
 * Dependency vulnerability gate — a drop-in replacement for
 * `npm audit --omit=dev --audit-level=high`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `npm audit` is currently broken against the public registry, for every npm client:
 * `POST /-/npm/v1/security/advisories/bulk` returns a **gzip-compressed body with no
 * `content-encoding: gzip` header**, so the client cannot decode it. npm's own fetch throws a
 * JSON parse error, falls back to the retired `/security/audits/quick` endpoint, and that
 * answers `400 Invalid package tree, run npm install to rebuild your package-lock.json` —
 * a red herring that has nothing to do with the lockfile. Reproduced on npm 10.8.2 and 11,
 * with a one-package payload, and with `accept-encoding: identity`.
 *
 * This script talks to the SAME advisory endpoint with the SAME request shape npm uses, and
 * simply gunzips the response when it arrives compressed. It is deliberately forward-compatible:
 * if the registry starts sending correct headers (or uncompressed JSON) it keeps working, so
 * this can be swapped back for plain `npm audit` whenever upstream is fixed.
 *
 * SEMANTICS (matched to the npm command it replaces)
 * --------------------------------------------------
 *  - Scope: production dependencies only — entries flagged `dev`/`devOptional` in the lockfile
 *    are skipped, exactly as `--omit=dev` does.
 *  - Threshold: fails on `high` and `critical` by default (`--audit-level`).
 *  - Version matching: an advisory counts only when an INSTALLED version satisfies its
 *    `vulnerable_versions` range.
 *
 * It never fails open: any transport error, non-200, or unparseable body exits non-zero with a
 * clear message, so a genuinely broken endpoint is loud rather than silently "green".
 *
 * Usage: node scripts/audit.mjs [--audit-level=high] [--include-dev]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = process.env.npm_config_registry ?? 'https://registry.npmjs.org';
const BULK_ENDPOINT = `${REGISTRY.replace(/\/$/, '')}/-/npm/v1/security/advisories/bulk`;

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

/**
 * Advisories that are known, reviewed, and accepted for now. Keep this EMPTY unless there is a
 * deliberate decision behind an entry — each one is a vulnerability we are shipping. Every entry
 * needs an owner-visible reason and, ideally, the condition that will let us drop it again.
 * Matched on the advisory `id` (GHSA), scoped to a package name so an id can never silently
 * suppress a finding elsewhere.
 *
 * @type {{ package: string, id: string, reason: string }[]}
 */
const ALLOWLIST = [
    {
        package: 'react-router',
        id: '1124282', // GHSA-qwww-vcr4-c8h2
        reason:
            'RSC Mode CSRF Bypass — requires React Router RSC mode, which this app does not use. ' +
            'It is a client-only Vite SPA: BrowserRouter only, no server request handler, no SSR, ' +
            'and no react-router/rsc, matchRSCServerRequest, unstable_RSC or createStaticHandler ' +
            'anywhere in src. Range >=7.12.0 <8.3.0 has no 7.x fix and react-router-dom publishes ' +
            'no 8.x, so clearing it means migrating off react-router-dom to react-router@8. ' +
            'DROP THIS ENTRY once that migration lands.',
    },
];

const args = process.argv.slice(2);
const levelArg = args.find((a) => a.startsWith('--audit-level='))?.split('=')[1] ?? 'high';
const includeDev = args.includes('--include-dev');
const threshold = SEVERITY_ORDER.indexOf(levelArg);
if (threshold === -1) {
    console.error(
        `audit: unknown --audit-level "${levelArg}" (expected one of ${SEVERITY_ORDER.join(', ')})`
    );
    process.exit(2);
}

/** Build npm's bulk payload — `{ packageName: [installedVersions] }` — from the lockfile. */
function buildPayload() {
    const lockPath = path.join(ROOT, 'package-lock.json');
    if (!fs.existsSync(lockPath)) {
        console.error('audit: package-lock.json not found — run `npm install` first');
        process.exit(2);
    }
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const byName = new Map();
    for (const [treePath, meta] of Object.entries(lock.packages ?? {})) {
        if (!treePath || !meta.version) continue; // '' is the root project itself
        if (!includeDev && (meta.dev || meta.devOptional)) continue; // mirrors --omit=dev
        const name = meta.name ?? treePath.split('node_modules/').pop();
        if (!byName.has(name)) byName.set(name, new Set());
        byName.get(name).add(meta.version);
    }
    return Object.fromEntries([...byName].map(([name, versions]) => [name, [...versions]]));
}

/** POST the payload and decode the reply, gunzipping when the registry omits content-encoding. */
async function fetchAdvisories(payload) {
    let res;
    try {
        res = await fetch(BULK_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        console.error(`audit: could not reach ${BULK_ENDPOINT} — ${err.message}`);
        process.exit(2);
    }
    if (!res.ok) {
        console.error(`audit: advisory endpoint returned ${res.status} ${res.statusText}`);
        process.exit(2);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // 1f 8b = gzip magic. The registry currently sends gzip WITHOUT declaring it, so sniff the
    // bytes rather than trusting the header; both shapes are handled.
    const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    let text;
    try {
        text = isGzip ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    } catch (err) {
        console.error(`audit: could not decompress the advisory response — ${err.message}`);
        process.exit(2);
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        console.error(`audit: advisory response was not valid JSON — ${err.message}`);
        process.exit(2);
    }
}

const payload = buildPayload();
const advisories = await fetchAdvisories(payload);

const findings = [];
for (const [name, list] of Object.entries(advisories)) {
    for (const advisory of list ?? []) {
        const affected = (payload[name] ?? []).filter((v) =>
            semver.satisfies(v, advisory.vulnerable_versions, { includePrerelease: true })
        );
        if (!affected.length) continue;
        // The endpoint sends `id` as a NUMBER; compare as strings so an allowlist entry written
        // either way matches.
        const allowed = ALLOWLIST.find(
            (a) => a.package === name && String(a.id) === String(advisory.id)
        );
        findings.push({
            name,
            versions: affected,
            severity: advisory.severity,
            title: advisory.title,
            url: advisory.url,
            id: advisory.id,
            allowed,
        });
    }
}

const scope = includeDev ? 'all dependencies' : 'production dependencies';
const atOrAboveThreshold = findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) >= threshold);
const blocking = atOrAboveThreshold.filter((f) => !f.allowed);
const accepted = atOrAboveThreshold.filter((f) => f.allowed);

console.log(
    `audit: scanned ${Object.keys(payload).length} ${scope} — ` +
        `${findings.length} advisories matched, ${atOrAboveThreshold.length} at or above "${levelArg}"`
);

for (const f of accepted) {
    console.log(`  ACCEPTED  [${f.severity}] ${f.name} ${f.versions.join(', ')} — ${f.title}`);
    console.log(`            ${f.id} · reason: ${f.allowed.reason}`);
}
for (const f of blocking) {
    console.log(`  ${f.severity.toUpperCase()}  ${f.name} ${f.versions.join(', ')} — ${f.title}`);
    console.log(`            ${f.id} · ${f.url}`);
}

if (blocking.length) {
    console.error(
        `\naudit: FAILED — ${blocking.length} unresolved advisory(ies) at or above "${levelArg}" in ${scope}.`
    );
    process.exit(1);
}
console.log(`audit: OK — no unresolved advisories at or above "${levelArg}" in ${scope}.`);
