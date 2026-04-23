'use strict';

const { createCanvas, registerFont } = require('canvas');
const path = require('path');
const fs   = require('fs');

const W = 1080;
const H = 1350;

const C = {
  bg:       '#0a0e1a',
  card:     '#111827',
  primary:  '#00D9FF',
  white:    '#ffffff',
  light:    '#e5e7eb',
  slate:    '#5a6478',
  darkBar:  '#1e293b',
  glow:     'rgba(0, 217, 255, 0.08)',
};

const FONT = 'Inter, Arial, sans-serif';

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function bg(ctx) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(0, 217, 255, 0.04)');
  g.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 217, 255, 0.03)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function footer(ctx) {
  ctx.fillStyle = C.darkBar;
  ctx.fillRect(0, H - 80, W, 80);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.primary;
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillText('RESIDUAL VAULT', W / 2, H - 42);
  ctx.fillStyle = C.slate;
  ctx.font = `16px ${FONT}`;
  ctx.fillText('residualvault.com', W / 2, H - 20);
  ctx.textAlign = 'left';
}

function slideNum(ctx, cur, total) {
  ctx.fillStyle = C.primary;
  ctx.font = `bold 18px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${String(cur).padStart(2, '0')}/${String(total).padStart(2, '0')}`, W - 60, 55);
  ctx.textAlign = 'left';
}

function renderCover(data) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  bg(ctx);

  ctx.textAlign = 'center';

  ctx.fillStyle = C.primary;
  ctx.fillRect(W / 2 - 40, 240, 80, 4);

  ctx.fillStyle = C.primary;
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillText((data.category || 'CRYPTO STAKING INTELLIGENCE').toUpperCase(), W / 2, 300);

  ctx.fillStyle = C.white;
  ctx.font = `bold 52px ${FONT}`;
  const tLines = wrap(ctx, data.title, W - 160);
  let y = 440;
  for (const l of tLines) { ctx.fillText(l, W / 2, y); y += 66; }

  if (data.subtitle) {
    ctx.fillStyle = C.light;
    ctx.font = `26px ${FONT}`;
    const sLines = wrap(ctx, data.subtitle, W - 160);
    y += 24;
    for (const l of sLines) { ctx.fillText(l, W / 2, y); y += 36; }
  }

  ctx.fillStyle = C.slate;
  ctx.font = `20px ${FONT}`;
  ctx.fillText('Swipe to learn more  →', W / 2, H - 140);

  ctx.textAlign = 'left';
  footer(ctx);
  return canvas.toBuffer('image/png');
}

function renderContent(data, num, total) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  bg(ctx);
  slideNum(ctx, num, total);

  const cx = 60, cy = 100, cw = W - 120, ch = H - 260;
  rr(ctx, cx, cy, cw, ch, 20);
  ctx.fillStyle = C.card;
  ctx.fill();

  ctx.fillStyle = C.primary;
  ctx.fillRect(cx, cy + 30, 5, ch - 60);

  if (data.number) {
    ctx.fillStyle = C.primary;
    ctx.font = `bold 80px ${FONT}`;
    ctx.globalAlpha = 0.12;
    ctx.fillText(String(data.number).padStart(2, '0'), cx + 40, cy + 120);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = C.primary;
  ctx.font = `bold 34px ${FONT}`;
  const hLines = wrap(ctx, data.heading, cw - 100);
  let y = cy + (data.number ? 170 : 80);
  for (const l of hLines) { ctx.fillText(l, cx + 50, y); y += 44; }

  y += 24;
  ctx.fillStyle = C.light;
  ctx.font = `25px ${FONT}`;
  const bLines = wrap(ctx, data.body, cw - 100);
  for (const l of bLines) { ctx.fillText(l, cx + 50, y); y += 36; }

  if (data.highlight) {
    y += 30;
    rr(ctx, cx + 35, y - 10, cw - 70, 70, 12);
    ctx.fillStyle = C.glow;
    ctx.fill();
    ctx.strokeStyle = C.primary;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.white;
    ctx.font = `bold 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(data.highlight, W / 2, y + 35);
    ctx.textAlign = 'left';
  }

  footer(ctx);
  return canvas.toBuffer('image/png');
}

function renderStats(data, num, total) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  bg(ctx);
  slideNum(ctx, num, total);

  if (data.heading) {
    ctx.fillStyle = C.white;
    ctx.font = `bold 32px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(data.heading, W / 2, 140);
    ctx.textAlign = 'left';
  }

  const stats = data.stats || [];
  const rows = Math.ceil(stats.length / 2);
  const colW = (W - 140) / 2;
  const rowH = Math.min(240, (H - 340) / rows);
  const startY = 200;

  stats.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 70 + col * colW;
    const y = startY + row * rowH;

    rr(ctx, x, y, colW - 20, rowH - 20, 16);
    ctx.fillStyle = C.card;
    ctx.fill();

    ctx.textAlign = 'center';
    const midX = x + (colW - 20) / 2;

    ctx.fillStyle = C.primary;
    ctx.font = `bold 48px ${FONT}`;
    ctx.fillText(s.value, midX, y + rowH / 2 - 15);

    ctx.fillStyle = C.white;
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillText(s.label, midX, y + rowH / 2 + 22);

    if (s.description) {
      ctx.fillStyle = C.slate;
      ctx.font = `16px ${FONT}`;
      const dLines = wrap(ctx, s.description, colW - 60);
      let dy = y + rowH / 2 + 48;
      for (const l of dLines) { ctx.fillText(l, midX, dy); dy += 20; }
    }
    ctx.textAlign = 'left';
  });

  footer(ctx);
  return canvas.toBuffer('image/png');
}

function renderCTA(data) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  bg(ctx);

  ctx.textAlign = 'center';

  ctx.fillStyle = C.primary;
  ctx.fillRect(W / 2 - 40, 320, 80, 4);

  ctx.fillStyle = C.white;
  ctx.font = `bold 42px ${FONT}`;
  const ctaLines = wrap(ctx, data.cta || 'Start tracking your yields today', W - 160);
  let y = 440;
  for (const l of ctaLines) { ctx.fillText(l, W / 2, y); y += 54; }

  y += 50;
  const btn = data.buttonText || 'Visit ResidualVault.com';
  ctx.font = `bold 26px ${FONT}`;
  const btnW = ctx.measureText(btn).width + 80;
  rr(ctx, (W - btnW) / 2, y - 30, btnW, 56, 28);
  ctx.fillStyle = C.primary;
  ctx.fill();
  ctx.fillStyle = C.bg;
  ctx.fillText(btn, W / 2, y + 4);

  y += 90;
  ctx.fillStyle = C.slate;
  ctx.font = `22px ${FONT}`;
  ctx.fillText(data.followText || 'Follow @residualvault for daily insights', W / 2, y);

  ctx.fillStyle = C.primary;
  ctx.fillRect(W / 2 - 30, y + 35, 60, 3);

  ctx.textAlign = 'left';
  footer(ctx);
  return canvas.toBuffer('image/png');
}

function renderCarousel(carouselData) {
  const { cover, slides, cta } = carouselData;
  const total = slides.length + 2;
  const buffers = [renderCover(cover)];
  slides.forEach((s, i) => {
    buffers.push(
      s.type === 'stats'
        ? renderStats(s, i + 2, total)
        : renderContent(s, i + 2, total)
    );
  });
  buffers.push(renderCTA(cta));
  return buffers;
}

module.exports = { renderCarousel };
