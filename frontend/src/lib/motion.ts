/**
 * Motion tokens — central source of truth for all animation timing across
 * ccweb. shadcn's own motion language (the Radix `data-[state=*]`
 * `animate-in/out` + `duration-200` pattern) is clipped, functional, and
 * never flashy. We mirror that here.
 *
 * ## Four durations, three easings
 *
 * - `fast`    ~150ms, `easeOut` — hover transitions, button press, icon swap
 * - `default` ~200ms, `easeOut` — popover/select/dialog enter + exit
 * - `slow`    ~300ms, `easeInOut` — page/panel transitions, reveal/collapse
 * - `glacial` ~500ms, `easeInOut` — large layout shifts only (rare)
 *
 * ## Usage
 *
 * Framer Motion:
 *   <motion.div transition={MOTION.default} animate={...} />
 *
 * Framer spread pattern for variants with overrides:
 *   transition={{ ...MOTION.default, delay: 0.05 }}
 *
 * Tailwind utility classes (prefer when no layout animation is needed):
 *   `transition-colors duration-150`   — fast
 *   `transition-all   duration-200`    — default
 *   `transition-transform duration-300`— slow
 *
 * DO NOT:
 * - pick arbitrary durations (250ms, 400ms, etc)
 * - use `easeIn` for enters (feels sluggish at start)
 * - animate colors with `easeInOut` (banding artifacts on most GPUs)
 */

/** Duration in seconds (Framer Motion native unit). */
export const MOTION_DURATION_S = {
  fast: 0.15,
  default: 0.2,
  slow: 0.3,
  glacial: 0.5,
} as const;

/** Duration in milliseconds (for Tailwind `duration-*` + setTimeout). */
export const MOTION_DURATION_MS = {
  fast: 150,
  default: 200,
  slow: 300,
  glacial: 500,
} as const;

/**
 * Framer Motion transition objects. Use by spreading or passing directly:
 *   transition={MOTION.default}
 *   transition={{ ...MOTION.default, delay: 0.05 }}
 */
export const MOTION = {
  fast: { duration: MOTION_DURATION_S.fast, ease: 'easeOut' as const },
  default: { duration: MOTION_DURATION_S.default, ease: 'easeOut' as const },
  slow: { duration: MOTION_DURATION_S.slow, ease: 'easeInOut' as const },
  glacial: { duration: MOTION_DURATION_S.glacial, ease: 'easeInOut' as const },
} as const;

/**
 * Common animation presets. Use when you want a one-liner.
 */
export const PRESETS = {
  /** Fade + slight Y-slide in. Matches shadcn Dialog / Popover feel. */
  fadeInUp: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
    transition: MOTION.default,
  },
  /** Pure fade. Use for crossfades between loading/loaded states. */
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: MOTION.default,
  },
  /** Scale + fade for popover-like floating UI. */
  popover: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
    transition: MOTION.default,
  },
} as const;
