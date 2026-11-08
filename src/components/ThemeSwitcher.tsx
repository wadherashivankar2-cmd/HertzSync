"use client";

import React, { useEffect, useState } from "react";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("hertzsync-theme") || localStorage.getItem("tricklesettle-theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    } else {
      const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
      const initial = prefersLight ? "light" : "dark";
      setTheme(initial);
      document.documentElement.setAttribute("data-theme", initial);
    }
  }, []);

  const selectTheme = (newTheme: "dark" | "light") => {
    setTheme(newTheme);
    localStorage.setItem("hertzsync-theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    if (newTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  };

  if (!mounted) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <span id="theme-control-label" className="text-xs font-semibold text-muted tracking-wide uppercase text-[11px]">
          Theme
        </span>
        <div
          role="group"
          aria-labelledby="theme-control-label"
          className="inline-flex items-center rounded-lg p-0.5 bg-surface-alt border border-border"
        >
          <button
            type="button"
            aria-pressed="true"
            className="min-h-[44px] min-w-[64px] px-3.5 py-1.5 rounded-md text-xs font-bold bg-[var(--accent)] text-[var(--accent-text)] border border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]"
          >
            Dark
          </button>
          <button
            type="button"
            aria-pressed="false"
            className="min-h-[44px] min-w-[64px] px-3.5 py-1.5 rounded-md text-xs font-semibold text-muted border border-transparent"
          >
            Light
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span id="theme-control-label" className="text-xs font-semibold text-muted tracking-wide uppercase text-[11px]">
        Theme
      </span>
      <div
        role="group"
        aria-labelledby="theme-control-label"
        className="inline-flex items-center rounded-lg p-0.5 bg-surface-alt border border-border"
      >
        <button
          type="button"
          aria-pressed={theme === "dark"}
          onClick={() => selectTheme("dark")}
          className={`min-h-[44px] min-w-[64px] px-3.5 py-1.5 rounded-md text-xs font-semibold btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-all ${
            theme === "dark"
              ? "bg-[var(--accent)] text-[var(--accent-text)] font-bold border border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]"
              : "text-muted hover:text-text border border-transparent"
          }`}
        >
          Dark
        </button>
        <button
          type="button"
          aria-pressed={theme === "light"}
          onClick={() => selectTheme("light")}
          className={`min-h-[44px] min-w-[64px] px-3.5 py-1.5 rounded-md text-xs font-semibold btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-all ${
            theme === "light"
              ? "bg-[var(--accent)] text-[var(--accent-text)] font-bold border border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]"
              : "text-muted hover:text-text border border-transparent"
          }`}
        >
          Light
        </button>
      </div>
    </div>
  );
}

