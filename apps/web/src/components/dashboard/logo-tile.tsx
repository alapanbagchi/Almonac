"use client";

import * as React from "react";
import NextImage from "next/image";

// Tile behind the hospital logo. Samples the logo opaque pixels at runtime
// and picks a tile that contrasts: light logos get a dark tile, dark logos
// get a light tile. Defaults to dark so first paint matches the sidebar.
export function LogoTile({ src, alt, size }: { src: string; alt: string; size: number }) {
  const [darkTile, setDarkTile] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => {
      const sample = 32;
      const canvas = document.createElement("canvas");
      canvas.width = sample;
      canvas.height = sample;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(probe, 0, 0, sample, sample);
      const pixels = ctx.getImageData(0, 0, sample, sample).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 128) {
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          n += 1;
        }
      }
      if (cancelled || n === 0) return;
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / n / 255;
      setDarkTile(luminance > 0.5);
    };
    probe.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  const mark = size - 12;
  return (
    <div
      data-slot="logo-tile"
      style={{ width: size, height: size }}
      className={
        darkTile
          ? "flex shrink-0 items-center justify-center rounded-xl bg-bark-raised transition-colors"
          : "flex shrink-0 items-center justify-center rounded-xl bg-parchment transition-colors"
      }
    >
      <NextImage src={src} alt={alt} width={mark} height={mark} />
    </div>
  );
}
