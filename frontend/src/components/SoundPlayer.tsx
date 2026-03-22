import { useEffect, useRef, useCallback } from 'react';
import { SoundConfig, getSoundFileUrl } from '@/lib/api';

interface SoundPlayerProps {
  projectId: string;
  config: SoundConfig | null;
  isActive: boolean;
}

// Preset sources that use loop mode by default
const LOOP_PRESETS = new Set(['preset:wind', 'preset:rain', 'preset:stream']);
// Preset sources that use interval mode by default
const INTERVAL_PRESETS = new Set(['preset:singing-bowl', 'preset:water-drops', 'preset:keyboard']);

function resolvePlayMode(config: SoundConfig): 'loop' | 'interval' {
  if (config.playMode !== 'auto') return config.playMode;
  if (LOOP_PRESETS.has(config.source)) return 'loop';
  if (INTERVAL_PRESETS.has(config.source)) return 'interval';
  // Custom sounds default to loop
  return 'loop';
}

export function SoundPlayer({ projectId, config, isActive }: SoundPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const fadeOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingRef = useRef(false);

  // Cleanup all resources
  const cleanup = useCallback(() => {
    if (fadeOutTimerRef.current) {
      clearTimeout(fadeOutTimerRef.current);
      fadeOutTimerRef.current = null;
    }
    if (intervalTimerRef.current) {
      clearTimeout(intervalTimerRef.current);
      intervalTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      try { gainNodeRef.current.disconnect(); } catch {}
      gainNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    audioRef.current = null;
    isPlayingRef.current = false;
  }, []);

  // Initialize audio element and Web Audio API graph lazily
  const ensureAudioContext = useCallback((src: string) => {
    // Create audio element if needed or src changed
    if (!audioRef.current || audioRef.current.src !== src) {
      // Tear down existing source node (tied to old audio element)
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.disconnect(); } catch {}
        sourceNodeRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(src);
      audio.crossOrigin = 'anonymous';
      audioRef.current = audio;
    }

    // Create AudioContext lazily
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }

    // Create gain node if needed
    if (!gainNodeRef.current) {
      const gainNode = audioCtxRef.current.createGain();
      gainNode.gain.value = 0;
      gainNode.connect(audioCtxRef.current.destination);
      gainNodeRef.current = gainNode;
    }

    // Create source node if needed (one per audio element)
    if (!sourceNodeRef.current) {
      const sourceNode = audioCtxRef.current.createMediaElementSource(audioRef.current);
      sourceNode.connect(gainNodeRef.current);
      sourceNodeRef.current = sourceNode;
    }

    return { audio: audioRef.current, ctx: audioCtxRef.current, gain: gainNodeRef.current };
  }, []);

  const startPlayback = useCallback((cfg: SoundConfig) => {
    const src = getSoundFileUrl(cfg.source, projectId);
    const volume = Math.max(0, Math.min(1, cfg.volume));
    const mode = resolvePlayMode(cfg);

    const { audio, ctx, gain } = ensureAudioContext(src);

    // Resume context (browser autoplay policy)
    ctx.resume().then(() => {
      // Cancel any scheduled fade-out
      if (fadeOutTimerRef.current) {
        clearTimeout(fadeOutTimerRef.current);
        fadeOutTimerRef.current = null;
      }
      if (intervalTimerRef.current) {
        clearTimeout(intervalTimerRef.current);
        intervalTimerRef.current = null;
      }

      if (mode === 'loop') {
        audio.loop = true;
        audio.currentTime = 0;
        audio.play().catch(() => {});
        isPlayingRef.current = true;
        // Fade in over 0.5s
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.5);
      } else {
        // Interval mode: play once, schedule next plays
        audio.loop = false;

        const playOnce = () => {
          if (!isPlayingRef.current) return;
          audio.currentTime = 0;
          audio.play().catch(() => {});
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.5);

          const onEnded = () => {
            if (!isPlayingRef.current) return;
            const [min, max] = cfg.intervalRange;
            const delay = (min + Math.random() * (max - min)) * 1000;
            intervalTimerRef.current = setTimeout(playOnce, delay);
          };
          audio.onended = onEnded;
        };

        isPlayingRef.current = true;
        playOnce();
      }
    }).catch(() => {});
  }, [projectId, ensureAudioContext]);

  const stopPlayback = useCallback(() => {
    if (!audioRef.current || !audioCtxRef.current || !gainNodeRef.current) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = false;

    // Clear interval timer
    if (intervalTimerRef.current) {
      clearTimeout(intervalTimerRef.current);
      intervalTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.onended = null;
    }

    const ctx = audioCtxRef.current;
    const gain = gainNodeRef.current;
    const audio = audioRef.current;

    // Fade out over 1s
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);

    // Pause after fade out completes
    fadeOutTimerRef.current = setTimeout(() => {
      fadeOutTimerRef.current = null;
      if (audio) audio.pause();
    }, 1100);
  }, []);

  // React to isActive changes
  useEffect(() => {
    if (!config || !config.enabled) return;

    if (isActive) {
      startPlayback(config);
    } else {
      stopPlayback();
    }
  }, [isActive, config, startPlayback, stopPlayback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Cleanup and restart when source changes
  useEffect(() => {
    if (!config) {
      cleanup();
      return;
    }
    // When source changes, reset audio node so ensureAudioContext picks up the new src
    if (audioRef.current) {
      const newSrc = getSoundFileUrl(config.source, projectId);
      if (audioRef.current.src !== newSrc) {
        stopPlayback();
        if (sourceNodeRef.current) {
          try { sourceNodeRef.current.disconnect(); } catch {}
          sourceNodeRef.current = null;
        }
        audioRef.current.pause();
        audioRef.current = null;
        // If currently active, restart with new source
        if (isActive) {
          startPlayback(config);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.source, projectId]);

  return null;
}

export default SoundPlayer;
