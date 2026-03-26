import { useEffect, useRef, memo } from 'react';

interface Star {
    x: number;
    y: number;
    size: number;
    brightness: number;
    twinkleSpeed: number;
    twinkleOffset: number;
}

interface ShootingStar {
    x: number;
    y: number;
    angle: number;
    speed: number;
    length: number;
    life: number;
    maxLife: number;
    brightness: number;
}

interface Spaceship {
    x: number;
    y: number;
    speed: number;
    size: number;
    direction: 1 | -1;
    trailLength: number;
    trailPoints: { x: number; y: number }[];
}

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
}

interface OverheadShip {
    progress: number;
    startX: number;
    startY: number;
    targetX: number;
    speed: number;
    trailPoints: { x: number; y: number; size: number }[];
}

export const SynthwaveCanvas = memo(({ animate = true }: { animate?: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const starsRef = useRef<Star[]>([]);
    const gridOffsetRef = useRef(0);
    const shootingStarsRef = useRef<ShootingStar[]>([]);
    const lastShootingStarRef = useRef(0);
    const spaceshipsRef = useRef<Spaceship[]>([]);
    const lastSpaceshipRef = useRef(0);
    const overheadShipsRef = useRef<OverheadShip[]>([]);
    const lastOverheadRef = useRef(0);
    const particlesRef = useRef<Particle[]>([]);
    const lightningRef = useRef(0);
    const lightningAlphaRef = useRef(0);
    const gridPulseRef = useRef(-1);
    const sunCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const lastSunDrawRef = useRef(-1);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Generate stars once
        if (starsRef.current.length === 0) {
            for (let i = 0; i < 150; i++) {
                starsRef.current.push({
                    x: Math.random(),
                    y: Math.random() * 0.5,
                    size: Math.random() * 1.5 + 0.3,
                    brightness: Math.random() * 0.6 + 0.2,
                    twinkleSpeed: Math.random() * 2 + 1,
                    twinkleOffset: Math.random() * Math.PI * 2,
                });
            }
        }

        // Generate floating particles once
        if (particlesRef.current.length === 0) {
            for (let i = 0; i < 40; i++) {
                particlesRef.current.push({
                    x: Math.random(),
                    y: Math.random() * 0.5,
                    vx: (Math.random() - 0.5) * 0.00015,
                    vy: -Math.random() * 0.0001 - 0.00005,
                    size: Math.random() * 1.2 + 0.3,
                    alpha: Math.random() * 0.3 + 0.15,
                });
            }
        }

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = canvas.offsetWidth * dpr;
            canvas.height = canvas.offsetHeight * dpr;
            ctx.scale(dpr, dpr);
            // Invalidate cached sun canvas on resize
            sunCanvasRef.current = null;
            lastSunDrawRef.current = -1;
        };

        resize();
        window.addEventListener('resize', resize);

        // Helper: draw fighter silhouette at current transform
        const drawFighter = (c: CanvasRenderingContext2D, s: number) => {
            c.beginPath();
            c.moveTo(s * 2.5, 0);
            c.lineTo(s * 1.2, -s * 0.25);
            c.lineTo(s * 0.3, -s * 0.3);
            c.lineTo(-s * 0.1, -s * 0.55);
            c.lineTo(-s * 0.5, -s * 0.35);
            c.lineTo(-s * 1.0, -s * 1.2);
            c.lineTo(-s * 1.5, -s * 1.0);
            c.lineTo(-s * 1.3, -s * 0.3);
            c.lineTo(-s * 1.5, -s * 0.15);
            c.lineTo(-s * 1.5, s * 0.15);
            c.lineTo(-s * 1.0, s * 0.2);
            c.lineTo(-s * 0.6, s * 0.5);
            c.lineTo(-s * 0.3, s * 0.25);
            c.lineTo(s * 0.5, s * 0.2);
            c.lineTo(s * 1.5, s * 0.1);
            c.closePath();
            c.fill();
        };

        // Helper: draw fighter from behind (overhead ships flying away)
        const drawFighterRear = (c: CanvasRenderingContext2D, s: number) => {
            c.beginPath();
            // Fuselage center
            c.moveTo(0, -s * 0.8);
            // Right side of fuselage
            c.lineTo(s * 0.4, -s * 0.5);
            // Right wing
            c.lineTo(s * 2.0, -s * 0.2);
            c.lineTo(s * 2.2, s * 0.1);
            c.lineTo(s * 0.6, s * 0.2);
            // Right engine
            c.lineTo(s * 0.5, s * 0.6);
            c.lineTo(s * 0.2, s * 0.6);
            // Tail center
            c.lineTo(s * 0.15, s * 0.3);
            // Dorsal fin
            c.lineTo(0, -s * 0.1);
            c.lineTo(-s * 0.15, s * 0.3);
            // Left engine
            c.lineTo(-s * 0.2, s * 0.6);
            c.lineTo(-s * 0.5, s * 0.6);
            c.lineTo(-s * 0.6, s * 0.2);
            // Left wing
            c.lineTo(-s * 2.2, s * 0.1);
            c.lineTo(-s * 2.0, -s * 0.2);
            // Left side of fuselage
            c.lineTo(-s * 0.4, -s * 0.5);
            c.closePath();
            c.fill();
        };

        // Helper: draw contrail as single batched path per alpha bucket
        const drawContrail = (
            c: CanvasRenderingContext2D,
            points: { x: number; y: number }[],
            maxAlpha: number,
            maxWidth: number
        ) => {
            if (points.length < 2) return;
            // Draw in 5 buckets instead of per-segment
            const buckets = 5;
            const segPerBucket = Math.ceil(points.length / buckets);
            for (let b = 0; b < buckets; b++) {
                const startIdx = Math.max(b * segPerBucket, 1);
                const endIdx = Math.min((b + 1) * segPerBucket, points.length);
                if (startIdx >= endIdx) continue;
                const midT = (startIdx + endIdx) / 2 / points.length;
                c.strokeStyle = `rgba(220, 200, 255, ${midT * maxAlpha})`;
                c.lineWidth = midT * maxWidth;
                c.beginPath();
                c.moveTo(points[startIdx - 1].x, points[startIdx - 1].y);
                for (let i = startIdx; i < endIdx; i++) {
                    c.lineTo(points[i].x, points[i].y);
                }
                c.stroke();
            }
        };

        const render = (time: number) => {
            const w = canvas.offsetWidth;
            const h = canvas.offsetHeight;
            const horizonY = h * 0.45;

            ctx.clearRect(0, 0, w, h);

            // === SKY ===
            const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
            skyGrad.addColorStop(0, '#0a0515');
            skyGrad.addColorStop(0.4, '#1a0a30');
            skyGrad.addColorStop(0.7, '#2a1045');
            skyGrad.addColorStop(1, '#3d1555');
            ctx.fillStyle = skyGrad;
            ctx.fillRect(0, 0, w, horizonY);

            // Nebula/pink patches on sides
            const nebulaLeft = ctx.createRadialGradient(
                w * 0.1,
                horizonY * 0.6,
                0,
                w * 0.1,
                horizonY * 0.6,
                w * 0.25
            );
            nebulaLeft.addColorStop(0, 'rgba(180, 40, 100, 0.15)');
            nebulaLeft.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = nebulaLeft;
            ctx.fillRect(0, 0, w * 0.4, horizonY);

            const nebulaRight = ctx.createRadialGradient(
                w * 0.9,
                horizonY * 0.5,
                0,
                w * 0.9,
                horizonY * 0.5,
                w * 0.2
            );
            nebulaRight.addColorStop(0, 'rgba(120, 30, 80, 0.1)');
            nebulaRight.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = nebulaRight;
            ctx.fillRect(w * 0.6, 0, w * 0.4, horizonY);

            // === STARS ===
            for (const star of starsRef.current) {
                const twinkle = animate
                    ? Math.sin(time * 0.001 * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7
                    : 1;
                const alpha = star.brightness * twinkle;
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.beginPath();
                ctx.arc(star.x * w, star.y * h, star.size, 0, Math.PI * 2);
                ctx.fill();
            }

            // === SHOOTING STARS ===
            if (animate) {
                if (time - lastShootingStarRef.current > 2000 + Math.random() * 4000) {
                    lastShootingStarRef.current = time;
                    const angle = Math.PI * 0.15 + Math.random() * Math.PI * 0.2;
                    shootingStarsRef.current.push({
                        x: Math.random() * w * 0.8 + w * 0.1,
                        y: Math.random() * horizonY * 0.4,
                        angle,
                        speed: 4 + Math.random() * 4,
                        length: 60 + Math.random() * 80,
                        life: 0,
                        maxLife: 40 + Math.random() * 30,
                        brightness: 0.6 + Math.random() * 0.4,
                    });
                }

                shootingStarsRef.current = shootingStarsRef.current.filter((s) => {
                    s.life++;
                    s.x += Math.cos(s.angle) * s.speed;
                    s.y += Math.sin(s.angle) * s.speed;

                    const progress = s.life / s.maxLife;
                    const alpha = s.brightness * (1 - progress);
                    const tailX = s.x - Math.cos(s.angle) * s.length * (1 - progress * 0.5);
                    const tailY = s.y - Math.sin(s.angle) * s.length * (1 - progress * 0.5);

                    // Glowing trail — no shadowBlur, use gradient instead
                    const grad = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
                    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
                    grad.addColorStop(0.6, `rgba(200, 180, 255, ${alpha * 0.4})`);
                    grad.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);

                    ctx.strokeStyle = grad;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(tailX, tailY);
                    ctx.lineTo(s.x, s.y);
                    ctx.stroke();

                    // Bright head
                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                    ctx.beginPath();
                    ctx.arc(s.x, s.y, 1.2, 0, Math.PI * 2);
                    ctx.fill();

                    return s.life < s.maxLife;
                });
            }

            // === SUN ===
            const sunR = h * 0.18;
            const sunX = w / 2;
            const sunY = horizonY - sunR * 0.6;

            // Sun outer glow
            const outerGlow = ctx.createRadialGradient(sunX, sunY, sunR, sunX, sunY, sunR * 4);
            outerGlow.addColorStop(0, 'rgba(255, 150, 180, 0.25)');
            outerGlow.addColorStop(0.3, 'rgba(200, 80, 150, 0.1)');
            outerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = outerGlow;
            ctx.fillRect(0, 0, w, horizonY + sunR);

            // Sun body — cached offscreen canvas, redrawn every ~3 frames
            const sunFrame = Math.floor(time / 50); // ~20fps for sun stripes
            if (!sunCanvasRef.current || sunFrame !== lastSunDrawRef.current) {
                if (!sunCanvasRef.current) {
                    sunCanvasRef.current = document.createElement('canvas');
                    sunCanvasRef.current.width = canvas.width;
                    sunCanvasRef.current.height = canvas.height;
                }
                lastSunDrawRef.current = sunFrame;
                const sunCtx = sunCanvasRef.current.getContext('2d')!;
                const dpr = canvas.width / w;
                sunCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                sunCtx.clearRect(0, 0, w, h);

                sunCtx.save();
                sunCtx.beginPath();
                sunCtx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
                sunCtx.clip();

                const sunGrad = sunCtx.createLinearGradient(sunX, sunY - sunR, sunX, sunY + sunR);
                sunGrad.addColorStop(0, '#ffccaa');
                sunGrad.addColorStop(0.3, '#ff99aa');
                sunGrad.addColorStop(0.6, '#ee6688');
                sunGrad.addColorStop(1, '#aa3366');
                sunCtx.fillStyle = sunGrad;
                sunCtx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);

                // Punch out stripes
                sunCtx.globalCompositeOperation = 'destination-out';
                const numSunStripes = 11;
                const sunStripeSpeed = animate ? (time * 0.00003) % 1 : 0;
                for (let i = 0; i < numSunStripes; i++) {
                    const rawPos = (i / numSunStripes + sunStripeSpeed) % 1;
                    const stripeY = sunY + sunR * (1 - rawPos * 2);
                    const thickness = 24 * Math.max(1 - rawPos / 0.7, 0);
                    if (thickness < 0.3) continue;

                    sunCtx.fillStyle = 'rgba(0, 0, 0, 1)';
                    sunCtx.fillRect(sunX - sunR, stripeY, sunR * 2, thickness);
                }
                sunCtx.restore();
            }
            ctx.drawImage(sunCanvasRef.current, 0, 0, canvas.width, canvas.height, 0, 0, w, h);

            // === OVERHEAD SHIPS (flying from sides toward horizon) ===
            if (animate) {
                if (overheadShipsRef.current.length < 1 && time - lastOverheadRef.current > 20000) {
                    lastOverheadRef.current = time;
                    const fromLeft = Math.random() > 0.5;
                    overheadShipsRef.current.push({
                        progress: 0,
                        startX: fromLeft ? -0.05 : 1.05,
                        startY: 0.2 + Math.random() * 0.4,
                        targetX: 0.3 + Math.random() * 0.4,
                        speed: 0.0012 + Math.random() * 0.0008,
                        trailPoints: [],
                    });
                }

                overheadShipsRef.current = overheadShipsRef.current.filter((os) => {
                    // Decelerate as ship approaches horizon for perspective
                    os.progress += os.speed * Math.max(1 - os.progress, 0.15);
                    const t = os.progress;
                    const screenX = (os.startX + (os.targetX - os.startX) * t) * w;
                    const screenY = (os.startY + (1.0 - os.startY) * t) * horizonY;
                    const shipScale = Math.max(1 - t * 0.85, 0.1);
                    const s = 5 * shipScale;

                    // Only add trail points while still flying
                    if (t < 1.0) {
                        os.trailPoints.push({ x: screenX, y: screenY, size: s });
                        if (os.trailPoints.length > 200) {
                            os.trailPoints.shift();
                        }
                    } else {
                        // Drain trail after reaching horizon
                        if (os.trailPoints.length > 0) os.trailPoints.shift();
                    }

                    drawContrail(ctx, os.trailPoints, 0.45, 2);

                    if (s > 0.4 && t < 1.0) {
                        ctx.save();
                        ctx.translate(screenX, screenY);
                        ctx.fillStyle = '#0d0620';
                        drawFighterRear(ctx, s);

                        // Engine glow — at tail, connecting into contrail above
                        const eg = ctx.createRadialGradient(0, -s * 0.2, 0, 0, -s * 0.2, s * 1.5);
                        eg.addColorStop(0, 'rgba(220, 180, 255, 0.7)');
                        eg.addColorStop(0.4, 'rgba(180, 100, 255, 0.3)');
                        eg.addColorStop(1, 'rgba(0, 0, 0, 0)');
                        ctx.fillStyle = eg;
                        ctx.fillRect(-s * 1.5, -s * 1.7, s * 3, s * 3);

                        ctx.restore();
                    }

                    return os.trailPoints.length > 0 || t < 1.0;
                });
            }

            // === DISTANT LIGHTNING (behind mountains) ===
            if (animate) {
                lightningAlphaRef.current *= 0.92;
                if (time - lightningRef.current > 6000 + Math.random() * 200) {
                    if (Math.random() < 0.02) {
                        lightningRef.current = time;
                        lightningAlphaRef.current = 0.3 + Math.random() * 0.3;
                    }
                }
                if (lightningAlphaRef.current > 0.01) {
                    const flashSeed = ((lightningRef.current * 7) % 100) / 100;
                    const centerX =
                        flashSeed < 0.5
                            ? w * (0.05 + flashSeed * 0.5)
                            : w * (0.7 + (flashSeed - 0.5) * 0.5);
                    const flashGrad = ctx.createRadialGradient(
                        centerX,
                        horizonY - 10,
                        0,
                        centerX,
                        horizonY * 0.7,
                        w * 0.2
                    );
                    flashGrad.addColorStop(0, `rgba(180, 140, 255, ${lightningAlphaRef.current})`);
                    flashGrad.addColorStop(
                        0.5,
                        `rgba(140, 80, 200, ${lightningAlphaRef.current * 0.4})`
                    );
                    flashGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    ctx.fillStyle = flashGrad;
                    ctx.fillRect(centerX - w * 0.25, 0, w * 0.5, horizonY + 20);
                }
            }

            // === MOUNTAINS ===
            ctx.fillStyle = '#0d0620';
            ctx.beginPath();
            ctx.moveTo(-10, horizonY);
            const mountainScale = Math.max(h * 0.012, Math.min(h, w) * 0.015);
            const peakHeights = [
                [-0.05, 1.5],
                [0.0, 3],
                [0.04, 4.5],
                [0.08, 3.5],
                [0.12, 5],
                [0.17, 3],
                [0.2, 2],
                [0.24, 3.5],
                [0.28, 4],
                [0.33, 2.5],
                [0.37, 1.5],
                [0.42, 2],
                [0.47, 1],
                [0.5, 0.5],
                [0.53, 0.8],
                [0.57, 1.5],
                [0.62, 3],
                [0.66, 2],
                [0.7, 3.5],
                [0.76, 5.5],
                [0.8, 4],
                [0.84, 4.5],
                [0.88, 3],
                [0.91, 4],
                [0.95, 2.5],
                [1.0, 1.5],
                [1.05, 1],
            ];
            for (const [px, peakH] of peakHeights) {
                ctx.lineTo(px * w, horizonY - peakH * mountainScale);
            }
            ctx.lineTo(w + 10, horizonY);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = 'rgba(80, 30, 80, 0.15)';
            ctx.fill();

            // === SPACESHIPS (drawn above sun/mountains) ===
            if (animate) {
                if (spaceshipsRef.current.length < 2 && time - lastSpaceshipRef.current > 15000) {
                    lastSpaceshipRef.current = time;
                    const direction = Math.random() > 0.5 ? 1 : -1;
                    const size = 2 + Math.random() * 2;
                    const sunCenterY = horizonY - h * 0.18 * 0.6;
                    const sunRadius = h * 0.18;
                    const yOffset = (Math.random() - 0.5) * sunRadius * 1.4;
                    spaceshipsRef.current.push({
                        x: direction === 1 ? -20 : w + 20,
                        y: Math.min(sunCenterY + yOffset, horizonY - 5),
                        speed: (0.8 + Math.random() * 1.2) * direction,
                        size,
                        direction,
                        trailLength: 80 + Math.random() * 120,
                        trailPoints: [],
                    });
                }

                spaceshipsRef.current = spaceshipsRef.current.filter((ship) => {
                    ship.x += ship.speed;
                    ship.y += Math.sin(ship.x * 0.005) * 0.1;

                    ship.trailPoints.push({ x: ship.x, y: ship.y });
                    if (ship.trailPoints.length > ship.trailLength) {
                        ship.trailPoints.shift();
                    }

                    drawContrail(ctx, ship.trailPoints, 0.35, 1.5);

                    ctx.save();
                    ctx.translate(ship.x, ship.y);
                    ctx.scale(ship.direction, 1);

                    ctx.fillStyle = '#0d0620';
                    drawFighter(ctx, ship.size);

                    // Engine glow — radial gradient, no shadowBlur
                    const engineGlow = ctx.createRadialGradient(
                        -ship.size,
                        0,
                        0,
                        -ship.size,
                        0,
                        ship.size * 1.5
                    );
                    engineGlow.addColorStop(0, 'rgba(200, 150, 255, 0.6)');
                    engineGlow.addColorStop(0.5, 'rgba(180, 100, 255, 0.2)');
                    engineGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    ctx.fillStyle = engineGlow;
                    ctx.fillRect(-ship.size * 2.5, -ship.size * 1.5, ship.size * 3, ship.size * 3);

                    ctx.restore();

                    return ship.direction === 1 ? ship.x < w + 50 : ship.x > -50;
                });
            }

            // === GROUND (below horizon) ===
            const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
            groundGrad.addColorStop(0, '#1a0835');
            groundGrad.addColorStop(0.05, '#0d0420');
            groundGrad.addColorStop(1, '#050210');
            ctx.fillStyle = groundGrad;
            ctx.fillRect(0, horizonY, w, h - horizonY);

            // === HORIZON GLOW LINE ===
            const horizGlow = ctx.createLinearGradient(0, horizonY - 8, 0, horizonY + 15);
            horizGlow.addColorStop(0, 'rgba(200, 100, 255, 0)');
            horizGlow.addColorStop(0.4, 'rgba(200, 100, 255, 0.6)');
            horizGlow.addColorStop(0.5, 'rgba(220, 120, 255, 0.9)');
            horizGlow.addColorStop(0.6, 'rgba(200, 100, 255, 0.6)');
            horizGlow.addColorStop(1, 'rgba(200, 100, 255, 0)');
            ctx.fillStyle = horizGlow;
            ctx.fillRect(0, horizonY - 8, w, 23);

            // === PERSPECTIVE GRID ===
            const gridBottom = h;
            const gridHeight = gridBottom - horizonY;
            const vanishX = w / 2;

            // Horizontal grid lines — NO shadowBlur, use double-draw for glow
            const numHLines = 20;
            const gridSpeed = animate ? gridOffsetRef.current : 0;
            const nearPlane = 1;
            const farPlane = 15;

            // First pass: wide faint "glow" lines — fade toward edges
            for (let i = 0; i < numHLines; i++) {
                const depth = farPlane - ((i / numHLines + gridSpeed) % 1) * (farPlane - nearPlane);
                const screenY = horizonY + gridHeight * (nearPlane / depth);
                const closeness = 1 - (depth - nearPlane) / (farPlane - nearPlane);
                const alpha = Math.min(closeness * 0.15, 0.12);
                const lineWidth = 2 + closeness * 6;

                const hGlowGrad = ctx.createLinearGradient(0, screenY, w, screenY);
                hGlowGrad.addColorStop(0, 'rgba(180, 80, 255, 0)');
                hGlowGrad.addColorStop(0.3, `rgba(180, 80, 255, ${alpha})`);
                hGlowGrad.addColorStop(0.7, `rgba(180, 80, 255, ${alpha})`);
                hGlowGrad.addColorStop(1, 'rgba(180, 80, 255, 0)');
                ctx.strokeStyle = hGlowGrad;
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                ctx.moveTo(0, screenY);
                ctx.lineTo(w, screenY);
                ctx.stroke();
            }
            // Second pass: thin bright core lines — fade toward edges
            for (let i = 0; i < numHLines; i++) {
                const depth = farPlane - ((i / numHLines + gridSpeed) % 1) * (farPlane - nearPlane);
                const screenY = horizonY + gridHeight * (nearPlane / depth);
                const closeness = 1 - (depth - nearPlane) / (farPlane - nearPlane);
                const alpha = Math.min(closeness * 0.8, 0.7);
                const lineWidth = 0.3 + closeness * 2;

                const hCoreGrad = ctx.createLinearGradient(0, screenY, w, screenY);
                hCoreGrad.addColorStop(0, 'rgba(180, 80, 255, 0)');
                hCoreGrad.addColorStop(0.25, `rgba(180, 80, 255, ${alpha})`);
                hCoreGrad.addColorStop(0.75, `rgba(180, 80, 255, ${alpha})`);
                hCoreGrad.addColorStop(1, 'rgba(180, 80, 255, 0)');
                ctx.strokeStyle = hCoreGrad;
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                ctx.moveTo(0, screenY);
                ctx.lineTo(w, screenY);
                ctx.stroke();
            }

            // Vertical grid lines — NO shadowBlur, double-draw for glow
            const aspectRatio = w / h;
            const numVLines = aspectRatio > 1.2 ? 40 : 20; // reduced from 60/30
            const spreadBottom = Math.max(w * 10, h * 12);
            const horizonSpread = Math.max(h * 0.2, w * 0.15);

            // Glow pass
            for (let i = 0; i <= numVLines; i++) {
                const t = i / numVLines;
                const bottomX = -spreadBottom * 0.3 + t * spreadBottom;
                const distFromCenter = t - 0.5;
                const topX = vanishX + distFromCenter * horizonSpread;
                const absFromCenter = Math.abs(distFromCenter);
                const bottomW = Math.max(14 - absFromCenter * 20, 0.8);
                const topW = 0.6;
                const alpha = 0.35 - absFromCenter * 0.35;

                ctx.fillStyle = `rgba(180, 80, 255, ${Math.max(alpha, 0.02)})`;
                ctx.beginPath();
                ctx.moveTo(topX - topW / 2, horizonY);
                ctx.lineTo(topX + topW / 2, horizonY);
                ctx.lineTo(bottomX + bottomW / 2, gridBottom);
                ctx.lineTo(bottomX - bottomW / 2, gridBottom);
                ctx.closePath();
                ctx.fill();
            }
            // Core pass
            for (let i = 0; i <= numVLines; i++) {
                const t = i / numVLines;
                const bottomX = -spreadBottom * 0.3 + t * spreadBottom;
                const distFromCenter = t - 0.5;
                const topX = vanishX + distFromCenter * horizonSpread;
                const absFromCenter = Math.abs(distFromCenter);
                const bottomW = Math.max(4 - absFromCenter * 6, 0.2);
                const topW = 0.15;
                const alpha = 0.55 - absFromCenter * 0.5;

                ctx.fillStyle = `rgba(180, 80, 255, ${Math.max(alpha, 0.05)})`;
                ctx.beginPath();
                ctx.moveTo(topX - topW / 2, horizonY);
                ctx.lineTo(topX + topW / 2, horizonY);
                ctx.lineTo(bottomX + bottomW / 2, gridBottom);
                ctx.lineTo(bottomX - bottomW / 2, gridBottom);
                ctx.closePath();
                ctx.fill();
            }

            // Center glow on grid
            const centerGlow = ctx.createRadialGradient(
                vanishX,
                horizonY + 20,
                0,
                vanishX,
                horizonY + gridHeight * 0.3,
                w * 0.4
            );
            centerGlow.addColorStop(0, 'rgba(180, 80, 255, 0.15)');
            centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = centerGlow;
            ctx.fillRect(0, horizonY, w, gridHeight);

            // === FADED OVERLAY ===
            const overlay = ctx.createLinearGradient(0, 0, 0, h);
            overlay.addColorStop(0, 'rgba(13, 10, 46, 0.6)');
            overlay.addColorStop(0.45, 'rgba(13, 10, 46, 0.35)');
            overlay.addColorStop(0.55, 'rgba(13, 10, 46, 0.35)');
            overlay.addColorStop(1, 'rgba(13, 10, 46, 0.65)');
            ctx.fillStyle = overlay;
            ctx.fillRect(0, 0, w, h);

            // === SCANLINES — single semi-transparent overlay rect with pattern ===
            ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
            for (let y = 0; y < h; y += 4) {
                ctx.fillRect(0, y, w, 1);
            }

            // === FLOATING PARTICLES ===
            if (animate) {
                for (const p of particlesRef.current) {
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.x < 0) p.x = 1;
                    if (p.x > 1) p.x = 0;
                    if (p.y < 0) p.y = 0.45;
                    if (p.y > 0.45) p.y = 0;

                    const flicker = Math.sin(time * 0.002 + p.x * 10) * 0.15 + 0.85;
                    ctx.fillStyle = `rgba(220, 180, 255, ${p.alpha * flicker})`;
                    ctx.beginPath();
                    ctx.arc(p.x * w, p.y * horizonY, p.size, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // === GRID PULSE (vertical lines sweep outward from center) ===
            if (animate) {
                if (gridPulseRef.current < 0 && Math.random() < 0.001) {
                    gridPulseRef.current = 0;
                }
                if (gridPulseRef.current >= 0) {
                    gridPulseRef.current += 0.008;
                    const pulseT = gridPulseRef.current;
                    const pulsePos = pulseT * 0.6;
                    const pulseWidth = 0.06;
                    const pulseAlpha = Math.max(0.7 - pulseT * 0.9, 0);

                    if (pulseAlpha > 0) {
                        const numVL = aspectRatio > 1.2 ? 40 : 20;
                        const spreadB = Math.max(w * 10, h * 12);
                        const horizSpread = Math.max(h * 0.2, w * 0.15);

                        for (let i = 0; i <= numVL; i++) {
                            const t = i / numVL;
                            const distFromCenter = Math.abs(t - 0.5);
                            const distFromPulse = Math.abs(distFromCenter - pulsePos);
                            if (distFromPulse > pulseWidth) continue;

                            const intensity = (1 - distFromPulse / pulseWidth) * pulseAlpha;
                            const bottomX = -spreadB * 0.3 + t * spreadB;
                            const topX = vanishX + (t - 0.5) * horizSpread;
                            const bottomW = Math.max(8 - distFromCenter * 12, 0.5);
                            const topW = 0.4;

                            ctx.fillStyle = `rgba(255, 200, 255, ${intensity})`;
                            ctx.beginPath();
                            ctx.moveTo(topX - topW / 2, horizonY);
                            ctx.lineTo(topX + topW / 2, horizonY);
                            ctx.lineTo(bottomX + bottomW / 2, gridBottom);
                            ctx.lineTo(bottomX - bottomW / 2, gridBottom);
                            ctx.closePath();
                            ctx.fill();
                        }
                    }

                    if (pulseT > 1.0) {
                        gridPulseRef.current = -1;
                    }
                }
            }

            if (animate) {
                gridOffsetRef.current += 0.002;
                if (gridOffsetRef.current >= 1) gridOffsetRef.current = 0;
                animationRef.current = requestAnimationFrame(render);
            }
        };

        if (animate) {
            animationRef.current = requestAnimationFrame(render);
        } else {
            render(0);
        }

        return () => {
            window.removeEventListener('resize', resize);
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [animate]);

    return <canvas ref={canvasRef} />;
});

SynthwaveCanvas.displayName = 'SynthwaveCanvas';
