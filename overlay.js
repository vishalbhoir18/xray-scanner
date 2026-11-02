// The flat layers around the 3D bones: the soft glow where the flesh is, and the
// labels and name tags on top.

import { BONE_INFO } from './facts.js';

export function strokeLine(t, pts, width) {
  t.lineWidth = width;
  t.beginPath();
  pts.forEach((q, i) => (i ? t.lineTo(q.x, q.y) : t.moveTo(q.x, q.y)));
  t.stroke();
}

// A line that fades away towards its far end, for an arm that runs out of view
export function fadeLine(t, a, b, width, color) {
  const g = t.createLinearGradient(a.x, a.y, b.x, b.y);
  g.addColorStop(0, color);
  g.addColorStop(0.2, color);
  g.addColorStop(1, color + '00');
  const before = t.strokeStyle;
  t.strokeStyle = g;
  t.lineCap = 'butt';
  strokeLine(t, [a, b], width);
  t.lineCap = 'round';
  t.strokeStyle = before;
}

export function fillPoly(t, pts, width) {
  t.lineWidth = width;
  t.beginPath();
  pts.forEach((q, i) => (i ? t.lineTo(q.x, q.y) : t.moveTo(q.x, q.y)));
  t.closePath();
  t.fill();
  t.stroke();
}

// The flesh layer is drawn small and stretched to fit, which gives it soft edges
export function drawTissue(canvas, figures, w, color, spread = 1) {
  const t = canvas.getContext('2d');
  const s = canvas.width / w;
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.clearRect(0, 0, canvas.width, canvas.height);
  t.setTransform(s, 0, 0, s, 0, 0);
  t.fillStyle = t.strokeStyle = color;
  t.lineCap = t.lineJoin = 'round';
  for (const f of figures) f.tissue(t, color, spread);
}

// Group labels with leader lines
// view = the part of the canvas visible on screen: { x0, y0, x1, y1 }
export function drawLabels(ctx, figures, fontPx, view) {
  ctx.save();
  ctx.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  const padX = fontPx * 0.6, hgt = fontPx * 1.7;
  const labels = figures.flatMap((f) => f.labels());
  for (const l of labels) l.w = ctx.measureText(l.text).width + padX * 2;

  // Nudge overlapping labels apart (matters when the figure is small on screen)
  for (let iter = 0; iter < 30; iter++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i].to, b = labels[j].to;
        const ox = (labels[i].w + labels[j].w) / 2 + 4 - Math.abs(a.x - b.x);
        const oy = hgt + 4 - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        // push along the axis that needs the smaller move
        if (oy < ox) {
          const s = a.y <= b.y ? -1 : 1;
          a.y += (s * oy) / 2; b.y -= (s * oy) / 2;
        } else {
          const s = a.x <= b.x ? -1 : 1;
          a.x += (s * ox) / 2; b.x -= (s * ox) / 2;
        }
      }
    }
    // keep every label on screen
    const m = fontPx * 0.5;
    for (const l of labels) {
      l.to.x = Math.max(view.x0 + l.w / 2 + m, Math.min(view.x1 - l.w / 2 - m, l.to.x));
      l.to.y = Math.max(view.y0 + hgt / 2 + m, Math.min(view.y1 - hgt / 2 - m, l.to.y));
    }
    if (!moved) break;
  }

  for (const l of labels) {
    const bx = l.to.x - l.w / 2, by = l.to.y - hgt / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(1, fontPx * 0.09);
    ctx.beginPath();
    ctx.moveTo(l.at.x, l.at.y);
    ctx.lineTo(l.to.x, l.to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(l.at.x, l.at.y, fontPx * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    roundRect(ctx, bx, by, l.w, hgt, hgt / 2);
    ctx.fillStyle = 'rgba(8, 16, 26, 0.85)';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e8f3ff';
    ctx.fillText(l.text, bx + padX, l.to.y);
  }
  ctx.restore();
}

// Name tag next to a bone
export function drawTag(ctx, figure, sel, fontPx, color = '#ffe066') {
  const c = figure.center(sel);
  if (!c) return;
  const text = BONE_INFO[sel.id].name;
  ctx.save();
  ctx.font = `700 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const padX = fontPx * 0.6, hgt = fontPx * 1.8;
  const x = c.x - tw / 2 - padX;
  const y = c.y - figure.unit * 0.1 - hgt;
  roundRect(ctx, x, y, tw + padX * 2, hgt, hgt / 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#1b1500';
  ctx.fillText(text, x + padX, y + hgt / 2);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
