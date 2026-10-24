"use client";
import { useEffect } from "react";

// Applies the studio's saved theme on every page, customer pages included. The last value is
// cached per browser so the next visit paints in the right colours before /api/config answers.
export default function ThemeSync() {
  useEffect(() => {
    const apply = (theme: string) => { document.documentElement.dataset.studioTheme = theme; };
    try { const cached = localStorage.getItem("studio-theme"); if (cached) apply(cached); } catch { /* storage blocked */ }
    fetch("/api/config", { cache: "no-store" }).then(r => r.json()).then(d => {
      if (!d.theme) return;
      apply(d.theme);
      try { localStorage.setItem("studio-theme", d.theme); } catch { /* storage blocked */ }
    }).catch(() => {});
  }, []);
  return null;
}
