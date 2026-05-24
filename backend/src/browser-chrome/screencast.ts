import type WebSocket from 'ws';
import type { Session } from './session-manager';
import { modLogger } from '../logger';

const log = modLogger('browser-chrome:screencast');

export interface ScreencastConfig {
  format: 'jpeg' | 'png';
  quality: number;
  maxWidth: number;
  maxHeight: number;
  everyNthFrame: number;
}

const DEFAULT: ScreencastConfig = {
  format: 'jpeg',
  quality: 70,
  maxWidth: 1280,
  maxHeight: 800,
  // 30fps source / 3 → ~10fps. Research/PoC confirm sweet spot.
  everyNthFrame: 3,
};

const WS_BUFFER_CEILING_BYTES = 4 * 1024 * 1024;

interface FramePayload {
  data: string;
  sessionId: number;
  metadata: { offsetTop?: number; deviceWidth?: number; deviceHeight?: number; pageScaleFactor?: number };
}

/**
 * Start CDP screencast on the given session, forwarding base64 frames to the
 * WebSocket as JSON messages. Returns a stopper that detaches the listener
 * and stops the upstream screencast.
 *
 * Backpressure: if ws.bufferedAmount exceeds the ceiling we skip sending the
 * frame to the client BUT still ack to chromium so it keeps producing.
 * Dropping the frame is preferable to letting daemon memory balloon when
 * a slow client falls behind.
 */
export async function startScreencast(
  session: Session,
  ws: WebSocket,
  cfg: Partial<ScreencastConfig> = {},
): Promise<() => Promise<void>> {
  const config = { ...DEFAULT, ...cfg };

  const onFrame = async (params: FramePayload) => {
    if (ws.readyState !== 1 /* OPEN */) return;

    const dropForBackpressure = ws.bufferedAmount > WS_BUFFER_CEILING_BYTES;
    if (!dropForBackpressure) {
      try {
        ws.send(JSON.stringify({
          type: 'frame',
          data: params.data,
          format: config.format,
          ts: Date.now(),
        }));
      } catch (err) {
        log.warn({ err, sid: session.sid }, 'frame send failed');
      }
    } else {
      log.warn({ sid: session.sid, buf: ws.bufferedAmount }, 'WS backlog, dropping frame');
    }

    // Always ack upstream — not acking would stall chromium for ALL clients
    // sharing the page (we're single-client per page, but still hygienic).
    try {
      await session.cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
    } catch (err) {
      // CDP may already be detached during teardown — not an error.
    }
  };

  session.cdp.on('Page.screencastFrame', onFrame as never);

  await session.cdp.send('Page.startScreencast', {
    format: config.format,
    quality: config.quality,
    maxWidth: config.maxWidth,
    maxHeight: config.maxHeight,
    everyNthFrame: config.everyNthFrame,
  });

  log.info({ sid: session.sid, config }, 'screencast started');

  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    session.cdp.off('Page.screencastFrame', onFrame as never);
    try {
      await session.cdp.send('Page.stopScreencast');
    } catch { /* session may already be dead */ }
    log.info({ sid: session.sid }, 'screencast stopped');
  };
}
