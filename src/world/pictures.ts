import { canvasTexture, rng } from '../textures.ts';

/**
 * One-off pictures drawn on canvas: carpets, the portrait, the calendar, notices, plates. Not cached:
 * anomalies redraw some of them (another carpet, another year), and each build owns its copies.
 */

/** A wall or floor carpet: border bands, a field of medallions. `variant` changes the ornament, not the colours. */
export function carpet(seed: number, variant = 0, colors = ['#7a1f1c', '#2b2236', '#c9a46a', '#d9cfb5']) {
  const [field, dark, gold, light] = colors;
  return canvasTexture(512, 288, (g, w, h) => {
    const r = rng(seed + variant * 1000);
    g.fillStyle = dark;
    g.fillRect(0, 0, w, h);
    // border bands
    for (const [inset, color] of [[6, gold], [14, dark], [22, light], [28, field]] as const) {
      g.fillStyle = color;
      g.fillRect(inset, inset, w - inset * 2, h - inset * 2);
    }
    // little stepped motifs along the border
    g.fillStyle = dark;
    for (let x = 30; x < w - 30; x += 18) {
      g.fillRect(x, 16, 8, 4);
      g.fillRect(x, h - 20, 8, 4);
    }
    // field: a lattice of medallions; the variant swaps the shapes
    const cols = variant ? 5 : 4;
    const rows = variant ? 3 : 2;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const cx = 40 + ((i + 0.5) * (w - 80)) / cols;
        const cy = 40 + ((j + 0.5) * (h - 80)) / rows;
        const rad = Math.min((w - 80) / cols, (h - 80) / rows) * 0.42;
        g.save();
        g.translate(cx, cy);
        for (let ring = 0; ring < 3; ring++) {
          g.fillStyle = [light, dark, gold][ring];
          const rr = rad * (1 - ring * 0.3);
          g.beginPath();
          const n = variant ? 6 : 8;
          for (let k = 0; k <= n * 2; k++) {
            const a = (k / (n * 2)) * Math.PI * 2;
            const rk = k % 2 ? rr * (variant ? 0.55 : 0.7) : rr;
            g.lineTo(Math.cos(a) * rk, Math.sin(a) * rk * 0.8);
          }
          g.fill();
        }
        g.restore();
      }
    // a few asymmetric details so "upside down" can be seen
    g.fillStyle = gold;
    g.beginPath();
    g.moveTo(w / 2 - 30, 40);
    g.lineTo(w / 2, 34 + 26);
    g.lineTo(w / 2 + 30, 40);
    g.fill();
    // wear and fibre
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,220'},${r() * 0.08})`;
      g.fillRect(r() * w, r() * h, 1, 2);
    }
  });
}

/** Where the portrait's eyes are on its canvas (256 x 320 px), and how big the whites are. */
export const PORTRAIT_EYES = { y: 0.41, dx: 21, white: 7 };

/** A stern man in a jacket, in oils, under varnish gone yellow. Without pupils, something else has to supply them. */
export function portrait(pupils = true) {
  return canvasTexture(256, 320, (g, w, h) => {
    const bg = g.createRadialGradient(w / 2, h * 0.4, 10, w / 2, h * 0.5, h * 0.7);
    bg.addColorStop(0, '#5d5638');
    bg.addColorStop(1, '#1f1c12');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a2622'; // jacket
    g.beginPath();
    g.moveTo(30, h);
    g.quadraticCurveTo(w / 2, h * 0.55, w - 30, h);
    g.fill();
    g.fillStyle = '#d8d0bc'; // shirt
    g.beginPath();
    g.moveTo(w / 2 - 18, h * 0.66);
    g.lineTo(w / 2, h * 0.8);
    g.lineTo(w / 2 + 18, h * 0.66);
    g.fill();
    g.fillStyle = '#b08866'; // face
    g.beginPath();
    g.ellipse(w / 2, h * 0.42, 46, 60, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a3026'; // hair
    g.beginPath();
    g.ellipse(w / 2, h * 0.3, 48, 28, 0, Math.PI, Math.PI * 2);
    g.fill();
    const e = PORTRAIT_EYES;
    g.fillStyle = '#d8ccb4'; // whites of the eyes
    for (const dx of [-e.dx, e.dx]) {
      g.beginPath();
      g.ellipse(w / 2 + dx, h * e.y, e.white + 2, e.white - 1, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#1d1a16'; // brows, pupils, mouth
    g.fillRect(w / 2 - 32, h * 0.37, 22, 4);
    g.fillRect(w / 2 + 10, h * 0.37, 22, 4);
    if (pupils)
      for (const dx of [-e.dx, e.dx]) {
        g.beginPath();
        g.arc(w / 2 + dx, h * e.y, 4, 0, Math.PI * 2);
        g.fill();
      }
    g.fillRect(w / 2 - 14, h * 0.53, 28, 3);
    g.fillStyle = 'rgba(200,170,60,0.12)'; // old varnish
    g.fillRect(0, 0, w, h);
  });
}

/** Tear-off calendar sheet: weekday, big date, month and year. */
export function calendarSheet(year: number) {
  return canvasTexture(128, 160, (g, w) => {
    g.fillStyle = '#f2ede0';
    g.fillRect(0, 0, w, 160);
    g.fillStyle = '#9a1d1d';
    g.textAlign = 'center';
    g.font = 'bold 16px serif';
    g.fillText('ПЯТНИЦА', w / 2, 24);
    g.font = 'bold 72px serif';
    g.fillText('13', w / 2, 96);
    g.fillStyle = '#222';
    g.font = 'bold 15px serif';
    g.fillText('ОКТЯБРЬ', w / 2, 122);
    g.font = '14px serif';
    g.fillText(String(year), w / 2, 144);
  });
}

/** A notice on the board: a typed sheet with a title. */
export function notice(title: string, lines: string[]) {
  return canvasTexture(256, 340, (g, w, h) => {
    g.fillStyle = '#efe9da';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1e1c18';
    g.textAlign = 'center';
    g.font = 'bold 26px serif';
    g.fillText(title, w / 2, 44);
    g.font = '17px serif';
    lines.forEach((l, i) => g.fillText(l, w / 2, 90 + i * 28));
  });
}

/** Number plate of a flat door: white digits on a dark oval. */
export function doorNumber(n: string) {
  return canvasTexture(128, 80, (g, w, h) => {
    g.fillStyle = '#c9b46a';
    g.beginPath();
    g.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a2418';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 44px serif';
    g.fillText(n, w / 2, h / 2 + 2);
  });
}

/** Pendulum clock dial: Roman numerals, no hands (the hands are meshes). */
export function clockDial() {
  return canvasTexture(256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#e8dfc4';
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1d1a14';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 26px serif';
    const roman = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    roman.forEach((t, i) => {
      const a = (i / 12) * Math.PI * 2;
      g.fillText(t, c + Math.sin(a) * (c - 34), c - Math.cos(a) * (c - 34));
    });
  });
}

/** The grey speaker cloth of a wired radio, with its maker's name (or, pencilled over it, someone else's). */
export function radioFront(name?: string) {
  return canvasTexture(128, 96, (g, w, h) => {
    g.fillStyle = '#8a8274';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(40,36,30,0.6)';
    for (let x = 6; x < w; x += 5) {
      g.beginPath();
      g.moveTo(x, 6);
      g.lineTo(x, h - 26);
      g.stroke();
    }
    g.fillStyle = '#2a2620';
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.fillText('ТОМЬ-303', w / 2, h - 8);
    if (name) {
      g.fillStyle = 'rgba(232,226,210,0.9)';
      g.fillRect(8, 26, w - 16, 24);
      g.fillStyle = '#5a1712';
      g.font = 'bold 18px serif';
      g.fillText(name.toUpperCase(), w / 2, 45, w - 20);
    }
  });
}

/** Whatever a dead CRT screen shows: dark grey-green glass with a faint glow at the middle. */
export function deadScreen() {
  return canvasTexture(128, 96, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.7);
    gr.addColorStop(0, '#3a403c');
    gr.addColorStop(1, '#141715');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}
