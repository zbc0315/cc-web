import { useState, useRef, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { MemoryPoolBall } from '@/lib/api';

const TYPE_FILL: Record<string, { main: string; light: string }> = {
  feedback: { main: '#4a6cf7', light: '#6b8cff' },
  user: { main: '#22c55e', light: '#5ee87a' },
  project: { main: '#f59e0b', light: '#fbbf4e' },
  reference: { main: '#a78bfa', light: '#c4b5fd' },
};

interface BallPos { x: number; y: number }

interface MemoryPoolBubbleDialogProps {
  balls: MemoryPoolBall[];
  selectedId?: string;
  activeCapacity: number;
  onClose: () => void;
}

export function MemoryPoolBubbleDialog({ balls, selectedId, activeCapacity, onClose }: MemoryPoolBubbleDialogProps) {
  const [selected, setSelected] = useState<string | undefined>(selectedId);
  const [positions, setPositions] = useState<Map<string, BallPos>>(new Map());
  const cleanupRef = useRef<(() => void) | null>(null);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const viewWidth = 600;
  const viewHeight = 500;
  const pad = 25;

  // Wedge: narrow top, wide bottom
  const wedgeTopW = viewWidth * 0.35;
  const wedgeBotW = viewWidth * 0.85;
  const topY = pad;
  const botY = viewHeight - pad;
  const topL = (viewWidth - wedgeTopW) / 2;
  const topR = (viewWidth + wedgeTopW) / 2;
  const botL = (viewWidth - wedgeBotW) / 2;
  const botR = (viewWidth + wedgeBotW) / 2;

  // Ball sizes from summary length
  const ballSizes = useMemo(() =>
    balls.map(b => Math.min(50, Math.max(24, 16 + b.summary.length * 0.4))),
    [balls],
  );

  // Stable key to avoid re-creating physics on every poll
  const ballsKey = balls.map(b => `${b.id}:${b.buoyancy.toFixed(2)}`).join(',');

  // ── Physics engine (Matter.js, dynamically imported) ─────────────────────
  useEffect(() => {
    // Cleanup previous engine
    cleanupRef.current?.();
    cleanupRef.current = null;

    let cancelled = false;

    import('matter-js').then((Matter) => {
      if (cancelled) return;

      const { Engine, Runner, Bodies, Composite, Body, Events } = Matter;

      const engine = Engine.create({
        gravity: { x: 0, y: 0.8, scale: 0.001 },
      });

      // ── Wedge container walls ──────────────────────────────────────────
      const wallT = 30;
      const wallOpts: Matter.IChamferableBodyDefinition = {
        isStatic: true,
        restitution: 0.2,
        friction: 0.05,
      };

      // Top wall
      const topWall = Bodies.rectangle(viewWidth / 2, topY - wallT / 2, wedgeTopW + wallT * 2, wallT, wallOpts);

      // Bottom wall
      const botWall = Bodies.rectangle(viewWidth / 2, botY + wallT / 2, wedgeBotW + wallT * 2, wallT, wallOpts);

      // Left angled wall
      const lDx = botL - topL;
      const lDy = botY - topY;
      const lLen = Math.sqrt(lDx * lDx + lDy * lDy) + wallT;
      const lAng = Math.atan2(lDy, lDx);
      const leftWall = Bodies.rectangle(
        (topL + botL) / 2, (topY + botY) / 2,
        lLen, wallT / 2,
        { ...wallOpts, angle: lAng },
      );

      // Right angled wall
      const rDx = botR - topR;
      const rDy = botY - topY;
      const rLen = Math.sqrt(rDx * rDx + rDy * rDy) + wallT;
      const rAng = Math.atan2(rDy, rDx);
      const rightWall = Bodies.rectangle(
        (topR + botR) / 2, (topY + botY) / 2,
        rLen, wallT / 2,
        { ...wallOpts, angle: rAng },
      );

      // ── Ball bodies ────────────────────────────────────────────────────
      // Spawn balls one by one from the bottom, highest buoyancy first,
      // with 100ms intervals. This naturally sorts them: high-B balls
      // rise first and claim the top; later balls settle below.
      // All balls float (buoyancy > gravity for all), no sinking.
      const bodies: Matter.Body[] = new Array(balls.length);
      const midX = viewWidth / 2;
      const spawnTimers: ReturnType<typeof setTimeout>[] = [];

      // Sort indices by buoyancy descending (spawn order)
      const spawnOrder = balls.map((_, i) => i)
        .sort((a, b) => balls[b].buoyancy - balls[a].buoyancy);

      Composite.add(engine.world, [topWall, botWall, leftWall, rightWall]);

      spawnOrder.forEach((ballIdx, spawnIdx) => {
        const timer = setTimeout(() => {
          if (cancelled) return;
          const r = ballSizes[ballIdx] / 2;
          const sx = midX + (Math.random() - 0.5) * wedgeBotW * 0.3;
          const sy = botY - r - 5; // Spawn just above the bottom wall

          const body = Bodies.circle(sx, sy, r, {
            restitution: 0.2,
            friction: 0.01,
            frictionAir: 0.02,
            label: balls[ballIdx].id,
          });
          bodies[ballIdx] = body;
          Composite.add(engine.world, body);
        }, spawnIdx * 100);
        spawnTimers.push(timer);
      });

      // ── Buoyancy force every tick ──────────────────────────────────────
      // All balls float: force = scale * B * mass. Scale chosen so even
      // the lowest buoyancy ball has net upward force.
      // gravity = 0.8 * 0.001 = 0.0008 per unit mass (downward).
      // buoyancyScale * minB must > 0.0008 → scale = 0.001 (safe margin).
      const buoyancyScale = 0.001;

      Events.on(engine, 'beforeUpdate', () => {
        for (let i = 0; i < balls.length; i++) {
          const body = bodies[i];
          if (!body) continue; // Not yet spawned
          Body.applyForce(body, body.position, {
            x: 0,
            y: -buoyancyScale * balls[i].buoyancy * body.mass,
          });
        }
      });

      // ── Run simulation ─────────────────────────────────────────────────
      const runner = Runner.create();
      Runner.run(runner, engine);

      // Sync physics → React state at ~30fps
      let frameId: number;
      const sync = () => {
        const map = new Map<string, BallPos>();
        for (let i = 0; i < balls.length; i++) {
          const body = bodies[i];
          if (body) map.set(balls[i].id, { x: body.position.x, y: body.position.y });
        }
        setPositions(map);
        frameId = requestAnimationFrame(sync);
      };
      frameId = requestAnimationFrame(sync);

      // Register cleanup
      cleanupRef.current = () => {
        spawnTimers.forEach(clearTimeout);
        cancelAnimationFrame(frameId);
        Runner.stop(runner);
        Events.off(engine, 'beforeUpdate');
        Composite.clear(engine.world, false);
        Engine.clear(engine);
      };
    });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballsKey, activeCapacity]);

  // ── Render ───────────────────────────────────────────────────────────────

  const selectedBall = balls.find(b => b.id === selected);
  const activeCount = Math.min(activeCapacity, balls.length);

  // Wedge outline
  const wedgePath = `M ${topL} ${topY} L ${topR} ${topY} L ${botR} ${botY} L ${botL} ${botY} Z`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="relative bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
        style={{
          width: Math.min(viewWidth + 40, window.innerWidth - 40),
          height: Math.min(viewHeight + 120, window.innerHeight - 40),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <span className="text-sm font-medium">记忆池全景</span>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> feedback</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> user</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> project</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> reference</span>
            <button onClick={onClose} aria-label="关闭" className="ml-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* SVG canvas */}
        <svg width="100%" height={viewHeight} viewBox={`0 0 ${viewWidth} ${viewHeight}`}>
          {/* Wedge container outline */}
          <path
            d={wedgePath}
            fill="none"
            className="stroke-border"
            strokeWidth={1.5}
            strokeLinejoin="round"
            opacity={0.5}
          />

          {/* Water surface indicator at top */}
          <line
            x1={topL + 4} y1={topY + 2} x2={topR - 4} y2={topY + 2}
            className="stroke-blue-500/30" strokeWidth={2}
          />

          {/* Links between connected balls */}
          {balls.map((b) =>
            b.links.map((targetId) => {
              const p1 = positions.get(b.id);
              const p2 = positions.get(targetId);
              if (!p1 || !p2) return null;
              return (
                <line
                  key={`${b.id}-${targetId}`}
                  x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke="#4a6cf744" strokeWidth={1} strokeDasharray="4,4"
                />
              );
            }),
          )}

          {/* Balls */}
          {balls.map((ball, i) => {
            const pos = positions.get(ball.id);
            if (!pos) return null;
            const size = ballSizes[i];
            const isActive = i < activeCount;
            const isSelected = ball.id === selected;
            const colors = TYPE_FILL[ball.type] ?? TYPE_FILL.reference;
            return (
              <g
                key={ball.id}
                onClick={() => setSelected(ball.id)}
                className="cursor-pointer"
                opacity={isActive ? 1 : 0.35}
              >
                <circle
                  cx={pos.x} cy={pos.y} r={size / 2}
                  fill={`url(#grad-${ball.type})`}
                  stroke={isSelected ? 'currentColor' : 'none'}
                  strokeWidth={isSelected ? 2 : 0}
                />
                {size > 30 && (
                  <text
                    x={pos.x} y={pos.y}
                    textAnchor="middle" dominantBaseline="central"
                    fill="#fff" fontSize={Math.max(9, size * 0.15)}
                    pointerEvents="none"
                  >
                    {ball.summary.slice(0, Math.floor(size / 5))}
                  </text>
                )}
                {isSelected && (
                  <circle
                    cx={pos.x} cy={pos.y} r={size / 2 + 4}
                    fill="none" stroke={colors.main} strokeWidth={1.5} opacity={0.6}
                  />
                )}
              </g>
            );
          })}

          {/* Gradients */}
          <defs>
            {Object.entries(TYPE_FILL).map(([type, { main, light }]) => (
              <radialGradient key={type} id={`grad-${type}`} cx="35%" cy="35%">
                <stop offset="0%" stopColor={light} />
                <stop offset="100%" stopColor={main} />
              </radialGradient>
            ))}
          </defs>
        </svg>

        {/* Selected ball info bar */}
        {selectedBall && (
          <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-background/95 border-t border-border">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] px-1 py-px rounded text-white" style={{ backgroundColor: TYPE_FILL[selectedBall.type]?.main ?? '#888' }}>{selectedBall.type}</span>
              {selectedBall.permanent && <span className="text-[10px] px-1 py-px rounded bg-orange-500/20 text-orange-400">permanent</span>}
              <span className="text-xs font-medium text-foreground">{selectedBall.summary}</span>
            </div>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span>B={selectedBall.buoyancy.toFixed(1)}</span>
              <span>H={selectedBall.H}</span>
              <span>硬度={selectedBall.hardness}</span>
              {selectedBall.links.length > 0 && <span>连线: {selectedBall.links.join(', ')}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
