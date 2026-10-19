#!/usr/bin/env node
/**
 * Arcade frame-cost benchmark. Drives the real arcade modules in headless Chrome against a
 * running Vite dev server and prints one JSON report.
 *
 *   npx vite --port 3011 &                       # VITE_ARCADE_SHIP_MODELS=1 for --model
 *   node scripts/arcade-bench.mjs --port 3011 [--frames 3000] [--model Terran_7] [--out file.json]
 *
 * What it measures, all at a 1280×720 CSS viewport and devicePixelRatio 1 (`ARCADE_MAX_DPR`
 * in `FlightGame`; --dpr overrides it):
 * - `flight.*`: `renderFlight` per frame over a scripted mid-run (speed 48, obstacles, pickups,
 *   duel checkpoints with gate sprites, lane slides, jumps and ducks, the shield always up). The
 *   game advances through the real `step` every frame; the player never dies (shield re-granted,
 *   duels skipped).
 *   - `record`: JS time only. Chrome defers rasterisation, so this is the main-thread cost of
 *     issuing the draw calls.
 *   - `raster`: the same, then a 1-pixel read back after every frame, which waits for the whole
 *     frame to be rasterised. Repeated read backs make Chrome move the canvas to software
 *     rendering (the same numbers as a browser started with accelerated 2D canvas off), so this
 *     is the CPU raster cost: what a device without GPU canvas pays, and a proxy for fill cost.
 *   Both run with the neon fighter and with a 3D frame grid (synthetic 256 px frames).
 * - `scene`: each background layer alone (raster mode), to attribute the background's cost.
 * - `alloc`: bytes allocated per `renderFlight` frame (sampling heap profiler, collected objects
 *   included) and the top allocating functions.
 * - `profile`: the top self-time functions over the record run.
 * - `step`: the engine's fixed step.
 * - `model` (with --model): the select screen's `ShipModelView` scene (official lighting, its
 *   shadow maps) rendered with a GPU sync per frame, and the duel summary's React commits.
 */
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');

const args = Object.fromEntries(
    process.argv
        .slice(2)
        .join(' ')
        .split('--')
        .filter(Boolean)
        .map((a) => {
            const [k, ...v] = a.trim().split(' ');
            return [k, v.join(' ') || 'true'];
        })
);
const port = Number(args.port ?? 3011);
const frames = Number(args.frames ?? 3000);
const model = args.model ?? null;
const dpr = Number(args.dpr ?? 1);

const browser = await puppeteer.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: dpr });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
// A static file: the app itself never boots, so nothing else draws while the benchmark runs.
await page.goto(`http://localhost:${port}/robots.txt`, { waitUntil: 'load' });
const cdp = await page.createCDPSession();

await page.evaluate(async (DPR) => {
    const R = await import('/src/components/arcade/flightRenderer.ts');
    const E = await import('/src/utils/arcade/engine.ts');
    const K = await import('/src/utils/arcade/checkpoints.ts');
    const S = await import('/src/components/theme/synthwaveScene.ts');
    const P = await import('/src/components/arcade/ships/spritePoses.ts');
    const J = await import('/src/components/arcade/projection.ts');

    const W = 1280;
    const H = 720;
    const makeCanvas = (opts) => {
        const c = document.createElement('canvas');
        c.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px`;
        document.body.appendChild(c);
        c.width = W * DPR;
        c.height = H * DPR;
        const ctx = c.getContext('2d', opts);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        return { c, ctx };
    };
    const shipFrame = (size, hue) => {
        const f = document.createElement('canvas');
        f.width = size;
        f.height = size;
        const x = f.getContext('2d');
        x.fillStyle = `hsl(${hue}, 60%, 60%)`;
        x.beginPath();
        x.moveTo(size / 2, size * 0.3);
        x.lineTo(size * 0.9, size * 0.6);
        x.lineTo(size / 2, size * 0.7);
        x.lineTo(size * 0.1, size * 0.6);
        x.closePath();
        x.fill();
        return f;
    };
    const frameGrid = () =>
        P.PITCH_ANGLES_DEG.map((_, p) =>
            P.BANK_ANGLES_DEG.map((_, b) =>
                P.HEADING_ANGLES_DEG.map((_, h) => shipFrame(256, p * 90 + b * 30 + h * 6))
            )
        );
    const gateSprite = shipFrame(128, 200);

    /** A scripted run: a fresh game and view, advanced one display frame per call. */
    const scriptedRun = (sprite, opts = {}) => {
        const game = E.createGame(7, { duels: true });
        game.speed = 48;
        const view = R.createFlightView(undefined, null, false);
        if (sprite) view.playerFrames = frameGrid();
        if (opts.trail === false) view.trail = null;
        const moves = ['left', 'jump', 'right', 'right', 'duck', 'left'];
        let n = 0;
        let now = 1000;
        const dt = 1 / 60;
        return (render) => {
            n++;
            now += 1000 * dt;
            const inputs = n % 45 === 0 ? [moves[(n / 45) % moves.length]] : [];
            game.player.shield = true;
            const before = game.distance;
            for (let i = 0; i < 2; i++) E.step(game, i === 0 ? inputs : [], dt / 2);
            R.advanceView(view, game.distance - before);
            if (game.status === 'duel') K.resolveDuel(game, 'skipped');
            if (game.status === 'over') game.status = 'running';
            for (const c of game.checkpoints) {
                if (!view.gateArt.has(c.id)) {
                    const art = {
                        name: 'Opponent',
                        level: 60,
                        portraitUrl: null,
                        sprite: gateSprite,
                    };
                    view.gateArt.set(c.id, [art, { ...art, name: 'Rival' }]);
                }
            }
            // A shield break every few seconds, so its effect is in the mix.
            if (n % 240 === 0) game.shieldBreakTime = 0.5;
            render(game, view, now, dt);
        };
    };

    const stats = (t) => {
        const s = [...t].sort((a, b) => a - b);
        const mean = s.reduce((a, b) => a + b, 0) / s.length;
        const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
        const r = (v) => Math.round(v * 1000) / 1000;
        return { mean: r(mean), p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]) };
    };

    const flight = (mode, sprite, count, warmup = 200, opts = {}) => {
        const { c, ctx } = makeCanvas();
        const advance = scriptedRun(sprite, opts);
        const times = [];
        for (let i = 0; i < warmup + count; i++) {
            advance((game, view, now, dt) => {
                const t0 = performance.now();
                R.renderFlight(ctx, game, view, now, dt);
                if (mode === 'raster') ctx.getImageData(0, 0, 1, 1);
                const t = performance.now() - t0;
                if (i >= warmup) times.push(t);
            });
        }
        c.remove();
        return stats(times);
    };

    const scene = (count) => {
        const { c, ctx } = makeCanvas();
        const g = S.sceneGeometry(W, H);
        const stars = S.createStars(150);
        const sun = S.createSunCache();
        const layers = {
            sky: () => S.drawSky(ctx, g),
            stars: (t) => S.drawStars(ctx, g, stars, t, true),
            sun: (t) => S.drawSun(ctx, g, sun, t, true),
            mountains: () => S.drawMountains(ctx, g),
            ground: () => S.drawGround(ctx, g),
            grid: (t) => S.drawGrid(ctx, g, (t / 3000) % 1, J.introGridLayers(g, 1)),
        };
        const out = {};
        for (const [name, draw] of Object.entries(layers)) {
            const times = [];
            for (let i = -20; i < count; i++) {
                ctx.clearRect(0, 0, W, H);
                ctx.getImageData(0, 0, 1, 1);
                const t0 = performance.now();
                draw(1000 + i * 16.7);
                ctx.getImageData(0, 0, 1, 1);
                if (i >= 0) times.push(performance.now() - t0);
            }
            out[name] = stats(times).mean;
        }
        c.remove();
        return out;
    };

    const step = () => {
        const game = E.createGame(3, { duels: true });
        game.speed = 48;
        const t0 = performance.now();
        const N = 200000;
        for (let i = 0; i < N; i++) {
            game.player.shield = true;
            E.step(game, [], 1 / 120);
            if (game.status === 'duel') K.resolveDuel(game, 'skipped');
        }
        return { usPerStep: Math.round(((performance.now() - t0) / N) * 1e6) / 1000 };
    };

    window.__bench = { flight, scene, step, scriptedRun, makeCanvas, R };
}, dpr);

const report = { frames, viewport: `1280x720@${dpr}x`, when: new Date().toISOString() };
report.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});

report.step = await page.evaluate(() => window.__bench.step());
report.flight = {};
for (const mode of ['record', 'raster']) {
    for (const sprite of [false, true]) {
        const key = `${mode}-${sprite ? 'sprite' : 'neon'}`;
        report.flight[key] = await page.evaluate(
            (m, s, n) => window.__bench.flight(m, s, n),
            mode,
            sprite,
            mode === 'raster' ? Math.min(frames, 600) : frames
        );
    }
}
// The same sprite runs without the ship's trails, to attribute their cost.
for (const mode of ['record', 'raster']) {
    report.flight[`${mode}-sprite-notrail`] = await page.evaluate(
        (m, n) => window.__bench.flight(m, true, n, 200, { trail: false }),
        mode,
        mode === 'raster' ? Math.min(frames, 600) : frames
    );
}
// A mid-range phone's main thread, roughly: the same runs under 6x CPU throttling.
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
report.flight['record-sprite-cpu6x'] = await page.evaluate(() =>
    window.__bench.flight('record', true, 1500)
);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
report.scene = await page.evaluate(() => window.__bench.scene(120));

// Allocation: the sampling heap profiler with collected objects kept, over a sprite run.
await cdp.send('HeapProfiler.enable');
await page.evaluate(() => {
    const b = window.__bench;
    const { c, ctx } = b.makeCanvas();
    const advance = b.scriptedRun(true);
    for (let i = 0; i < 200; i++) advance((g, v, n, d) => b.R.renderFlight(ctx, g, v, n, d));
    window.__allocRun = () => {
        for (let i = 0; i < 2000; i++) advance((g, v, n, d) => b.R.renderFlight(ctx, g, v, n, d));
        c.remove();
    };
});
await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 256,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
});
await page.evaluate(() => window.__allocRun());
const { profile: heap } = await cdp.send('HeapProfiler.stopSampling');
{
    const byFn = new Map();
    let total = 0;
    const walk = (node) => {
        const name = `${node.callFrame.functionName || '(anon)'} ${node.callFrame.url.split('/').pop()?.split('?')[0]}:${node.callFrame.lineNumber + 1}`;
        byFn.set(name, (byFn.get(name) ?? 0) + node.selfSize);
        total += node.selfSize;
        node.children.forEach(walk);
    };
    walk(heap.head);
    report.alloc = {
        note: '2000 frames incl. 2 engine steps each; bytes include the engine',
        bytesPerFrame: Math.round(total / 2000),
        top: [...byFn.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([k, v]) => `${Math.round(v / 2000)} B/frame ${k}`),
    };
}

// CPU profile over a record run.
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await cdp.send('Profiler.start');
await page.evaluate((n) => window.__bench.flight('record', true, n, 0), frames);
const { profile } = await cdp.send('Profiler.stop');
{
    const self = new Map();
    const dtById = new Map();
    profile.samples.forEach((id, i) =>
        dtById.set(id, (dtById.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0))
    );
    let total = 0;
    for (const node of profile.nodes) {
        const t = dtById.get(node.id) ?? 0;
        const cf = node.callFrame;
        const name = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()?.split('?')[0]}:${cf.lineNumber + 1}`;
        self.set(name, (self.get(name) ?? 0) + t);
        total += t;
    }
    report.profile = [...self.entries()]
        .filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)'))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14)
        .map(([k, v]) => `${((100 * v) / total).toFixed(1)}% ${k}`);
}

if (model) {
    report.model = await page.evaluate(async (key) => {
        // The same three.js module instance the arcade's own modules import.
        const lighting = await (await fetch('/src/components/arcade/ships/shipLighting.ts')).text();
        const three = await import(
            lighting.match(/"(\/node_modules\/\.vite\/deps\/three\.js[^"]*)"/)[1]
        );
        const L = await import('/src/components/arcade/ships/shipModelLoader.ts');
        const Li = await import('/src/components/arcade/ships/shipLighting.ts');
        const loaded = await L.loadShipModel(key);
        const run = async (maps, label) => {
            const width = 448;
            const height = 192;
            const renderer = new three.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setPixelRatio(2);
            renderer.setSize(width, height);
            document.body.appendChild(renderer.domElement);
            const scene = new three.Scene();
            const lights = Li.lightShipScene(scene, renderer, maps);
            const camera = new three.PerspectiveCamera(30, width / height, 0.1, 20);
            camera.position.set(0, 0.8, 2.7);
            camera.lookAt(0, 0, 0);
            lights.aim([0, 0.8, 2.7]);
            const ship = loaded.clone();
            scene.add(ship);
            const gl = renderer.getContext();
            const px = new Uint8Array(4);
            const times = [];
            for (let i = 0; i < 140; i++) {
                ship.rotation.y += 0.01;
                const t0 = performance.now();
                renderer.render(scene, camera);
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                if (i >= 20) times.push(performance.now() - t0);
            }
            lights.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
            renderer.domElement.remove();
            const s = times.sort((a, b) => a - b);
            return `${label}: mean ${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)} ms, p95 ${s[Math.floor(s.length * 0.95)].toFixed(2)} ms`;
        };
        return [
            await run(
                Li.VIEW_SHADOW_MAPS,
                `select view, shadow maps ${JSON.stringify(Li.VIEW_SHADOW_MAPS)}`
            ),
            await run({ key: 1024, rim: 512 }, 'select view, shadow maps 1024/512'),
            await run({ key: 0, rim: 0 }, 'select view, no shadows'),
        ];
    }, model);
}

// Duel summary: React commits and their render time over its playback.
report.duel = await page.evaluate(async () => {
    // The React refresh preamble index.html would install; the app itself never boots here.
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const entry = await (await fetch('/src/index.tsx')).text();
    const url = (name) =>
        entry.match(new RegExp(`"(/node_modules/\\.vite/deps/${name}\\.js\\?v=[^"]+)"`))[1];
    const React = (await import(url('react'))).default;
    const ReactDOM = (await import(url('react-dom_client'))).default;
    const { DuelSummary } = await import('/src/components/arcade/duel/DuelSummary.tsx');
    const timeline = Array.from({ length: 31 }, (_, i) => ({
        round: i,
        playerHpPct: 100 - i * 2,
        enemyHpPct: 100 - i * 3,
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    let commits = 0;
    let renderMs = 0;
    const side = { name: 'Ship', level: 60, imageUrl: null };
    root.render(
        React.createElement(
            React.Profiler,
            {
                id: 'duel',
                onRender: (_id, _phase, actual) => {
                    commits++;
                    renderMs += actual;
                },
            },
            React.createElement(DuelSummary, {
                player: side,
                opponent: side,
                stakes: 'power-up',
                result: { outcome: 'win', timeline },
                effect: { kind: 'shield' },
                onDone: () => {},
            })
        )
    );
    await new Promise((r) => setTimeout(r, 5600));
    root.unmount();
    host.remove();
    return { playbackSeconds: 5, rounds: 31, commits, renderMs: Math.round(renderMs * 10) / 10 };
});

const json = JSON.stringify(report, null, 2);
if (args.out) fs.writeFileSync(args.out, json);
console.log(json);
await browser.close();
