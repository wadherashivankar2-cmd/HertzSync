"use client";

import React, { useEffect, useState } from "react";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("tricklesettle-theme");
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
    localStorage.setItem("tricklesettle-theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    if (newTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  };

  if (!mounted) {
    return (
      <div
        role="group"
        aria-label="Theme switcher"
        className="inline-flex rounded-lg p-1 bg-surface-alt border border-border"
      >
        <button
          type="button"
          aria-pressed="true"
          className="min-h-[44px] min-w-[56px] px-3.5 py-1.5 rounded-md text-xs font-semibold bg-surface text-text border border-border"
        >
          Dark
        </button>
        <button
          type="button"
          aria-pressed="false"
          className="min-h-[44px] min-w-[56px] px-3.5 py-1.5 rounded-md text-xs font-semibold text-muted"
        >
          Light
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Theme switcher"
      className="inline-flex rounded-lg p-1 bg-surface-alt border border-border"
    >
      <button
        type="button"
        aria-pressed={theme === "dark"}
        onClick={() => selectTheme("dark")}
        className={`min-h-[44px] min-w-[56px] px-3.5 py-1.5 rounded-md text-xs font-semibold btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-all ${
          theme === "dark"
            ? "bg-surface text-text shadow-sm border border-border"
            : "text-muted hover:text-text"
        }`}
      >
        Dark
      </button>
      <button
        type="button"
        aria-pressed={theme === "light"}
        onClick={() => selectTheme("light")}
        className={`min-h-[44px] min-w-[56px] px-3.5 py-1.5 rounded-md text-xs font-semibold btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-all ${
          theme === "light"
            ? "bg-surface text-text shadow-sm border border-border"
            : "text-muted hover:text-text"
        }`}
      >
        Light
      </button>
    </div>
  );
}

