/**
 * P1 — burned-in overlay for the images Gemini receives (plan §3c item 2):
 *   9 vertical dividers with bearing labels along the top, the `level` distance per
 *   column along the bottom, a 1-px horizon line, and ground-distance ticks at
 *   2 / 5 / 10 m projected with the known camera. Not drawn on the UI copies.
 */
import { CAMERA_VFOV_DEG, LIDAR_COLUMN_KEYS, SENSOR_HEIGHT_M, SENSOR_IMAGE_H, SENSOR_IMAGE_W } from '../constants';
import { DEG } from '../geo';
import type { LidarGrid } from '../types';

/** Pixel row where a ground point at horizontal distance d (m) appears (camera level). */
export function groundRowForDistance(d: number, h = SENSOR_IMAGE_H): number {
  const ang = Math.atan(SENSOR_HEIGHT_M / d); // below horizon
  const half = Math.tan((CAMERA_VFOV_DEG / 2) * DEG);
  return h / 2 + ((h / 2) * Math.tan(ang)) / half;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, lidar: LidarGrid, w: number, h: number, label?: string): void {
  const colW = w / LIDAR_COLUMN_KEYS.length;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = `${Math.round(h / 32)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // dividers + top labels
  for (let i = 0; i < LIDAR_COLUMN_KEYS.length; i++) {
    const x = i * colW;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
    ctx.stroke();
    const key = LIDAR_COLUMN_KEYS[i];
    const text = Number(key) > 0 ? `+${key}°` : `${key}°`;
    pill(ctx, x + colW / 2, 3, text, 'rgba(0,0,0,0.6)', '#fff');
  }
  // bottom distances (level row)
  ctx.textBaseline = 'bottom';
  for (let i = 0; i < LIDAR_COLUMN_KEYS.length; i++) {
    const key = LIDAR_COLUMN_KEYS[i];
    const cell = lidar.level[key];
    const g = lidar.ground[key];
    const txt = cell.m === null ? '>30' : `${cell.m.toFixed(1)}`;
    const color = cell.m === null ? '#9f9' : cell.m < 3 ? '#f66' : '#ff6';
    pill(ctx, i * colW + colW / 2, h - 3, txt, 'rgba(0,0,0,0.6)', color, true);
    if (g.hit !== 'GROUND') {
      ctx.textBaseline = 'bottom';
      pill(ctx, i * colW + colW / 2, h - 3 - h / 26, g.hit === 'WATER' ? 'water' : g.hit === 'FALLEN_LOG' ? 'log' : g.hit.toLowerCase(), 'rgba(0,0,0,0.5)', '#8cf', true);
    }
  }
  // horizon
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(0, Math.round(h / 2) + 0.5);
  ctx.lineTo(w, Math.round(h / 2) + 0.5);
  ctx.stroke();
  // ground ticks
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const d of [2, 5, 10]) {
    const y = groundRowForDistance(d, h);
    if (y > h - h / 10) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`${d} m`, 4, y - h / 50);
  }
  if (label) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(label, w - 4, h / 14);
  }
  ctx.restore();
}

function pill(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string, bg: string, fg: string, bottom = false) {
  const m = ctx.measureText(text);
  const pw = m.width + 6;
  const ph = Math.round(parseInt(ctx.font, 10) * 1.25);
  const top = bottom ? y - ph : y;
  ctx.fillStyle = bg;
  ctx.fillRect(cx - pw / 2, top, pw, ph);
  ctx.fillStyle = fg;
  ctx.fillText(text, cx, bottom ? y : y + 1);
}

let scratch: HTMLCanvasElement | null = null;
function getScratch(w: number, h: number): HTMLCanvasElement {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  return scratch;
}

/**
 * Compose `source` (a canvas / bitmap with the sensor render, or null for a black frame)
 * with the overlay and return a base64 JPEG (no data: prefix).
 */
export function renderGeminiImage(
  source: CanvasImageSource | null,
  lidar: LidarGrid,
  label: string,
  w = SENSOR_IMAGE_W,
  h = SENSOR_IMAGE_H,
  quality = 0.7,
): string {
  const c = getScratch(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (source) ctx.drawImage(source, 0, 0, w, h);
  drawOverlay(ctx, lidar, w, h, label);
  const url = c.toDataURL('image/jpeg', quality);
  return url.slice(url.indexOf(',') + 1);
}
