"use client";

import createGlobe from "cobe";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function CobeGlobe({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.append(canvas);

    let globe: ReturnType<typeof createGlobe> | null = null;
    let rafId = 0;
    let phi = 0;
    let side = 0;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const dark = document.documentElement.classList.contains("dark");

    const render = (nextSide: number) => {
      if (nextSide < 32) {
        return;
      }

      side = nextSide;
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      if (!globe) {
        globe = createGlobe(canvas, {
          devicePixelRatio,
          width: side,
          height: side,
          phi: 0,
          theta: 0.15,
          dark: dark ? 1 : 0,
          diffuse: 1.2,
          mapSamples: 16_000,
          mapBrightness: dark ? 6 : 4,
          baseColor: [0.3, 0.3, 0.3],
          markerColor: [0.32, 0.55, 0.72],
          glowColor: dark ? [1, 1, 1] : [0.85, 0.85, 0.85],
          markers: [
            { location: [37.7595, -122.4367], size: 0.03 },
            { location: [40.7128, -74.006], size: 0.1 },
          ],
        });
      }

      const tick = () => {
        globe?.update({ width: side, height: side, phi });
        if (!reduceMotion) {
          phi += 0.005;
        }
        rafId = requestAnimationFrame(tick);
      };

      cancelAnimationFrame(rafId);
      tick();
    };

    const observer = new ResizeObserver((entries) => {
      render(Math.round(entries[0]?.contentRect.width ?? 0));
    });

    observer.observe(container);
    render(Math.round(container.getBoundingClientRect().width));

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
      globe?.destroy();
      container.replaceChildren();
    };
  }, []);

  return <div ref={containerRef} className={cn("aspect-square", className)} />;
}
