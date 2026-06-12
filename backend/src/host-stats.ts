import os from 'os';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Host machine resource stats for the dashboard "host usage" badge.
 *
 * CPU% and network throughput are *rates* — they need two samples spaced in
 * time. Rather than run an always-on timer, we cache the previous raw counters
 * at module scope and compute the delta against the next call. The dashboard
 * polls every few seconds, so the delta window is the inter-poll interval. The
 * very first call (and any after a >30s gap) has no usable baseline and returns
 * cpu=0 / net=null; the next poll is accurate.
 */

export interface HostStats {
  cpu: number; // 0-100, percent busy across all cores since last sample
  cores: number;
  loadAvg: number; // 1-minute load average
  mem: { total: number; used: number; percent: number };
  disk: { total: number; used: number; percent: number } | null;
  net: { rxBytesPerSec: number; txBytesPerSec: number } | null;
  uptimeSec: number;
  platform: string;
  hostname: string;
}

interface CpuSample {
  idle: number;
  total: number;
}
interface NetSample {
  rx: number;
  tx: number;
}

let lastCpu: CpuSample | null = null;
let lastNet: { sample: NetSample; at: number } | null = null;

// Short cache of the computed snapshot. CPU% and net rate are deltas against
// the previous sample, so concurrent callers (multiple tabs / LAN users) would
// otherwise split a single delta window and get jumpy readings. Serving one
// snapshot for ~1.5s — shorter than the dashboard's 3s poll, so a lone watcher
// still recomputes every poll — keeps readings stable and throttles `netstat`.
const CACHE_MS = 1500;
let lastResult: { at: number; value: HostStats } | null = null;

function sampleCpu(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const v of Object.values(cpu.times)) total += v;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

// Prime a CPU baseline at load so the first request is already meaningful.
lastCpu = sampleCpu();

function computeCpuPercent(): number {
  const cur = sampleCpu();
  let percent = 0;
  if (lastCpu) {
    const idleDelta = cur.idle - lastCpu.idle;
    const totalDelta = cur.total - lastCpu.total;
    if (totalDelta > 0) {
      percent = Math.round((1 - idleDelta / totalDelta) * 100);
      percent = Math.max(0, Math.min(100, percent));
    }
  }
  lastCpu = cur;
  return percent;
}

/** Read cumulative rx/tx byte counters summed over physical interfaces. */
async function sampleNet(): Promise<NetSample | null> {
  try {
    if (process.platform === 'linux') {
      const data = await fs.promises.readFile('/proc/net/dev', 'utf8');
      let rx = 0;
      let tx = 0;
      for (const line of data.split('\n')) {
        const m = line.match(/^\s*([^:]+):\s*(.*)$/);
        if (!m) continue;
        const iface = m[1].trim();
        if (iface === 'lo') continue;
        const cols = m[2].trim().split(/\s+/).map(Number);
        // cols: 0=rxBytes ... 8=txBytes (see /proc/net/dev column layout)
        rx += cols[0] || 0;
        tx += cols[8] || 0;
      }
      return { rx, tx };
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('netstat', ['-ibn'], { timeout: 2000 });
      let rx = 0;
      let tx = 0;
      const seen = new Set<string>();
      for (const line of stdout.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        // Canonical per-interface counters live on the <Link#N> row, which
        // carries a MAC address → exactly 11 columns:
        // Name Mtu <Link#N> MAC Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
        // MAC-less rows (lo0, gif0, utun*) have fewer columns and are skipped.
        if (cols.length < 11 || !/^<Link#\d+>$/.test(cols[2])) continue;
        const name = cols[0];
        if (name === 'lo0' || seen.has(name)) continue;
        const ibytes = Number(cols[6]);
        const obytes = Number(cols[9]);
        if (Number.isFinite(ibytes) && Number.isFinite(obytes)) {
          rx += ibytes;
          tx += obytes;
          seen.add(name);
        }
      }
      return { rx, tx };
    }
  } catch {
    return null;
  }
  return null;
}

async function sampleDisk(): Promise<HostStats['disk']> {
  const path = process.platform === 'win32' ? 'C:\\' : '/';
  try {
    const st = await fs.promises.statfs(path);
    const total = st.blocks * st.bsize;
    const bfree = st.bfree * st.bsize; // free incl. root-reserved
    const bavail = st.bavail * st.bsize; // free to unprivileged users
    const used = total - bfree;
    // Match `df` capacity: used / (used + available), ignoring root reserve.
    const denom = used + bavail;
    const percent = denom > 0 ? Math.round((used / denom) * 100) : 0;
    return { total, used, percent };
  } catch {
    return null;
  }
}

export async function getHostStats(): Promise<HostStats> {
  if (lastResult && Date.now() - lastResult.at < CACHE_MS) return lastResult.value;

  const cpu = computeCpuPercent();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const [disk, net] = await Promise.all([sampleDisk(), sampleNet()]);

  let netRate: HostStats['net'] = null;
  const now = Date.now();
  if (net) {
    if (lastNet && now > lastNet.at && now - lastNet.at < 30_000) {
      const dt = (now - lastNet.at) / 1000;
      netRate = {
        rxBytesPerSec: Math.max(0, Math.round((net.rx - lastNet.sample.rx) / dt)),
        txBytesPerSec: Math.max(0, Math.round((net.tx - lastNet.sample.tx) / dt)),
      };
    }
    lastNet = { sample: net, at: now };
  }

  const value: HostStats = {
    cpu,
    cores: os.cpus().length,
    loadAvg: Math.round(os.loadavg()[0] * 100) / 100,
    mem: { total: totalMem, used: usedMem, percent: Math.round((usedMem / totalMem) * 100) },
    disk,
    net: netRate,
    uptimeSec: Math.round(os.uptime()),
    platform: process.platform,
    hostname: os.hostname(),
  };
  lastResult = { at: Date.now(), value };
  return value;
}
