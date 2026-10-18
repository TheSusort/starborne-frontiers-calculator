import { useEffect, useRef, memo } from 'react';
import { requestFlight } from '../arcade/flightEvents';
import {
    createStars,
    createSunCache,
    drawContrail,
    drawFadeOverlay,
    drawFighter,
    drawFighterRear,
    drawGrid,
    drawGround,
    drawMountains,
    drawSky,
    drawStars,
    drawSun,
    hitTestOverheadShip,
    sceneGeometry,
    type OverheadShipHit,
    type Star,
    type SunCache,
} from './synthwaveScene';

const INTERACTIVE_SELECTOR =
    'a, button, input, select, textarea, label, [role="button"], [contenteditable="true"]';

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
    const overheadHitRef = useRef<OverheadShipHit | null>(null);
    const lastOverheadRef = useRef(0);
    const particlesRef = useRef<Particle[]>([]);
    const lightningRef = useRef(0);
    const lightningAlphaRef = useRef(0);
    const gridPulseRef = useRef(-1);
    const sunCacheRef = useRef<SunCache>(createSunCache());

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Generate stars once
        if (starsRef.current.length === 0) starsRef.current = createStars(150);

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
            sunCacheRef.current = createSunCache();
        };

        resize();
        window.addEventListener('resize', resize);

        // Observe the canvas element so we re-resize when it becomes visible
        // (e.g. parent goes from display:none to display:block on theme swap)
        const resizeObserver = new ResizeObserver(() => {
            if (canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
                resize();
            }
        });
        resizeObserver.observe(canvas);

        const render = (time: number) => {
            const w = canvas.offsetWidth;
            const h = canvas.offsetHeight;
            const g = sceneGeometry(w, h);

            ctx.clearRect(0, 0, w, h);
            const { horizonY } = g;

            drawSky(ctx, g);

            drawStars(ctx, g, starsRef.current, time, animate);

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

            if (canvas.width === 0 || canvas.height === 0) {
                animationRef.current = requestAnimationFrame(render);
                return;
            }
            drawSun(ctx, g, sunCacheRef.current, time, animate);

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
                    overheadHitRef.current =
                        t < 1.0 && s > 0.4
                            ? { x: screenX, y: screenY, size: s, progress: t }
                            : null;

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
                if (overheadShipsRef.current.length === 0) overheadHitRef.current = null;
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

            drawMountains(ctx, g);

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

            drawGround(ctx, g);

            drawGrid(ctx, g, animate ? gridOffsetRef.current : 0);

            drawFadeOverlay(ctx, g);

            // Scanlines handled by CSS body::after overlay

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

            const aspectRatio = w / h;
            const { vanishX } = g;
            const gridBottom = h;

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
            resizeObserver.disconnect();
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [animate]);

    // The background sits under the page (pointer-events: none), so clicks are read at the
    // document and matched against the overhead fighter's last drawn position.
    useEffect(() => {
        if (!animate) return;
        const onPointerDown = (e: PointerEvent) => {
            const canvas = canvasRef.current;
            if (!canvas || canvas.offsetWidth === 0) return;
            if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) return;
            const rect = canvas.getBoundingClientRect();
            const ship = overheadHitRef.current;
            if (!ship || !hitTestOverheadShip(ship, e.clientX - rect.left, e.clientY - rect.top))
                return;
            const flying = overheadShipsRef.current[0];
            if (flying) flying.progress = 1;
            overheadHitRef.current = null;
            requestFlight({ x: ship.x + rect.left, y: ship.y + rect.top, size: ship.size });
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [animate]);

    return <canvas ref={canvasRef} />;
});

SynthwaveCanvas.displayName = 'SynthwaveCanvas';
