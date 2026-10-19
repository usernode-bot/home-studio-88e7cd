// Rasterising an SVG page to PNG or JPEG on a canvas, and the scale limits
// browsers can actually draw.

// The largest scale <= want whose output stays inside browser limits:
// each side <= 16384 px, and area <= 16,777,216 px (the iOS Safari ceiling).
export function fitScale(w, h, want) {
  const MAX_SIDE = 16384;
  const MAX_AREA = 16777216;
  let s = Math.max(0.0625, want);
  const fits = (k) => w * k <= MAX_SIDE && h * k <= MAX_SIDE && w * k * h * k <= MAX_AREA;
  if (!fits(s)) {
    s = Math.min((MAX_SIDE - 1) / w, (MAX_SIDE - 1) / h, Math.sqrt(MAX_AREA / (w * h)));
  }
  return Math.max(0.0625, Math.floor(s * 1000) / 1000);
}

// Draw the SVG at w × h and hand back a Blob. JPEG fills the background
// first (white when the page has none): JPEG has no transparency. The canvas
// is drawn twice, a frame apart, which works around WebKit painting embedded
// images late.
export function rasterize(svg, w, h, { type = 'image/png', quality, background } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = async () => {
      try {
        await img.decode().catch(() => {});
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (type === 'image/jpeg') {
          ctx.fillStyle = background || '#ffffff';
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        await new Promise((r) => requestAnimationFrame(r));
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error("The page couldn't be drawn to an image."));
        }, type, quality);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error("The page couldn't be drawn."));
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The page couldn't be drawn to an image.")); };
    img.src = url;
  });
}