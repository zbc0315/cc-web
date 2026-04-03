import { useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { MemoryPoolBall } from '@/lib/api';

const TYPE_FILL: Record<string, { main: string; light: string }> = {
  feedback: { main: '#4a6cf7', light: '#6b8cff' },
  user: { main: '#22c55e', light: '#5ee87a' },
  project: { main: '#f59e0b', light: '#fbbf4e' },
  reference: { main: '#a78bfa', light: '#c4b5fd' },
};

interface MemoryPoolBubbleDialogProps {
  balls: MemoryPoolBall[];
  selectedId?: string;
  activeCapacity: number;
  onClose: () => void;
}

export function MemoryPoolBubbleDialog({ balls, selectedId, activeCapacity, onClose }: MemoryPoolBubbleDialogProps) {
  const [selected, setSelected] = useState<string | undefined>(selectedId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state (refs to avoid stale closures)
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-ball]')) return;
    draggingRef.current = true;
    dragStartRef.current = { x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    const newOffset = {
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    };
    offsetRef.current = newOffset;
    setOffset(newOffset);
  }, []);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const maxBuoyancy = balls.length > 0 ? Math.max(...balls.map(b => b.buoyancy), 0.01) : 1;
  const viewHeight = 500;
  const viewWidth = 600;
  const padding = 60;

  const positioned = balls.map((ball, i) => {
    const ratio = maxBuoyancy > 0 ? ball.buoyancy / maxBuoyancy : 0;
    const y = padding + (viewHeight - padding * 2) * (1 - ratio);
    const xBase = viewWidth / 2;
    const xSpread = (viewWidth - padding * 2) * 0.4;
    const angle = (i * 137.5 * Math.PI) / 180;
    const r = Math.sqrt(i + 1) * (xSpread / Math.sqrt(balls.length + 1));
    const x = xBase + Math.cos(angle) * r;
    const minSize = 20;
    const maxSize = 60;
    const size = Math.min(maxSize, Math.max(minSize, 15 + ball.summary.length * 0.5));
    return { ball, x, y, size };
  });

  const selectedBall = balls.find(b => b.id === selected);

  const dividerY = activeCapacity < balls.length
    ? (() => {
        const lastActive = positioned[activeCapacity - 1];
        const firstDeep = positioned[activeCapacity];
        return lastActive && firstDeep ? (lastActive.y + firstDeep.y) / 2 : viewHeight - padding;
      })()
    : viewHeight - padding;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="relative bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
        style={{ width: Math.min(viewWidth + 40, window.innerWidth - 40), height: Math.min(viewHeight + 120, window.innerHeight - 40) }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <span className="text-sm font-medium">记忆池全景</span>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> feedback</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> user</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> project</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> reference</span>
            <button onClick={onClose} className="ml-2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* SVG canvas */}
        <div
          ref={containerRef}
          className="cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <svg width="100%" height={viewHeight} viewBox={`0 0 ${viewWidth} ${viewHeight}`}>
            <g transform={`translate(${offset.x}, ${offset.y})`}>
              {/* Active/Deep divider */}
              <line x1={padding} y1={dividerY} x2={viewWidth - padding} y2={dividerY} stroke="#333" strokeDasharray="4,4" />
              <text x={viewWidth - padding} y={dividerY - 5} textAnchor="end" fill="#555" fontSize="9">深层</text>

              {/* Links */}
              {positioned.map(({ ball: b, x: x1, y: y1 }) =>
                b.links.map((targetId) => {
                  const target = positioned.find(p => p.ball.id === targetId);
                  if (!target) return null;
                  return (
                    <line
                      key={`${b.id}-${targetId}`}
                      x1={x1} y1={y1} x2={target.x} y2={target.y}
                      stroke="#4a6cf744" strokeWidth={1} strokeDasharray="4,4"
                    />
                  );
                })
              )}

              {/* Balls */}
              {positioned.map(({ ball, x, y, size }) => {
                const isActive = balls.indexOf(ball) < activeCapacity;
                const isSelected = ball.id === selected;
                const colors = TYPE_FILL[ball.type] ?? TYPE_FILL.reference;
                return (
                  <g
                    key={ball.id}
                    data-ball
                    onClick={() => setSelected(ball.id)}
                    className="cursor-pointer"
                    opacity={isActive ? 1 : 0.35}
                  >
                    <circle
                      cx={x} cy={y} r={size / 2}
                      fill={`url(#grad-${ball.type})`}
                      stroke={isSelected ? '#fff' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                    />
                    {size > 30 && (
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={Math.max(8, size * 0.15)}>
                        {ball.summary.slice(0, Math.floor(size / 5))}
                      </text>
                    )}
                    {isSelected && (
                      <circle cx={x} cy={y} r={size / 2 + 4} fill="none" stroke={colors.main} strokeWidth={1} opacity={0.5} />
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
            </g>
          </svg>
        </div>

        {/* Selected ball info bar */}
        {selectedBall && (
          <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-background/95 border-t border-border">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[9px] px-1 py-px rounded text-white" style={{ backgroundColor: TYPE_FILL[selectedBall.type]?.main ?? '#888' }}>{selectedBall.type}</span>
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
