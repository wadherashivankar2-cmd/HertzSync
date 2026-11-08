"use client";

import React from "react";
import Link from "next/link";
import { ThemeSwitcher } from "../components/ThemeSwitcher";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-bg text-text relative flex flex-col justify-between p-4 sm:p-8 transition-colors duration-200">
      {/* Decorative Role 2 fade rising from the bottom 25-30% of the viewport (decorative only, aria-hidden, pointer-events none) */}
      <div
        className="fixed inset-x-0 bottom-0 h-[28vh] pointer-events-none z-0"
        aria-hidden="true"
        style={{ background: "linear-gradient(to top, var(--role2-fade), transparent)" }}
      />

      {/* Top Header bar with ThemeSwitcher */}
      <header className="relative z-10 max-w-5xl w-full mx-auto flex items-center justify-between py-2 border-b border-border pb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-bold tracking-tight text-text hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded p-1 transition-colors"
        >
          <span className="text-[var(--accent)] font-mono text-base" aria-hidden="true">
            ⚡
          </span>
          <span>HertzSync</span>
        </Link>
        <ThemeSwitcher />
      </header>

      {/* Main Container - Solid surface, thin rules, agreed non-centred layout */}
      <div className="relative z-10 max-w-5xl w-full mx-auto my-auto bg-surface border border-border rounded-xl shadow-xl overflow-hidden transition-colors duration-200">
        {/* Upper Area: Static SVG with thin rules */}
        <div className="p-6 sm:p-8 border-b border-border bg-surface-alt/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Static SVG in upper area: 404 vector numeral & flatline sensor track */}
            <svg
              width="170"
              height="48"
              viewBox="0 0 170 48"
              aria-hidden="true"
              className="overflow-visible"
            >
              {/* Vector 404 glyphs (vector paths prevent axe text color-contrast ambiguity) */}
              <g stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.30">
                <path d="M18 10 L6 28 L24 28 M18 10 L18 38" />
                <path d="M38 18 C38 11 50 11 50 18 L50 30 C50 37 38 37 38 30 Z" />
                <path d="M72 10 L60 28 L78 28 M72 10 L72 38" />
              </g>
              <line
                x1="94"
                y1="24"
                x2="158"
                y2="24"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeDasharray="4 3"
              />
              <circle cx="158" cy="24" r="3" fill="var(--accent)" />
            </svg>
          </div>

          {/* Status pill: No events here */}
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border text-xs text-muted font-mono"
            role="status"
            aria-label="No events recorded for this route"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            <span>No events here.</span>
          </div>
        </div>

        {/* Content Section: Headline Left, Explanation & One Primary Button Right */}
        <div className="p-6 sm:p-10 grid grid-cols-1 md:grid-cols-2 gap-8 items-center bg-surface">
          {/* Left Column: Headline */}
          <div className="space-y-2">
            <span
              aria-hidden="true"
              className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--accent)]"
            >
              Error 404 · Unindexed Route
            </span>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-text tracking-tight leading-tight">
              This page isn't in the ledger.
            </h1>
          </div>

          {/* Right Column: Explanation and one primary button right */}
          <div className="flex flex-col items-start md:items-end justify-center space-y-4 text-left md:text-right">
            <p className="text-sm sm:text-base text-muted leading-relaxed max-w-md">
              The page you're looking for doesn't exist or has moved.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a
                href="https://github.com/wadherashivankar2-cmd/Solpro#readme"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-lg bg-surface-alt hover:bg-surface-hover text-text border border-border font-semibold text-sm btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] inline-flex items-center justify-center transition-all"
              >
                Check the README
              </a>
              <Link
                href="/dashboard"
                style={{ boxShadow: "0 0 16px 0 var(--accent-glow)" }}
                className="min-h-[44px] min-w-[44px] px-6 py-2.5 rounded-lg bg-[var(--accent)] text-[var(--accent-text)] font-semibold text-sm btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] inline-flex items-center justify-center transition-all"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>

        {/* Thin bottom rule / info strip inside solid card */}
        <div className="px-6 py-3 border-t border-border bg-surface-alt/30 flex items-center justify-between text-xs text-muted font-mono">
          <span>Solana DevNet Reliability Layer</span>
          <span>HTTP 404 NOT_FOUND</span>
        </div>
      </div>

      {/* Footer info strip on solid surface */}
      <footer className="relative z-10 max-w-5xl w-full mx-auto text-center py-2">
        <div className="inline-block px-4 py-1.5 rounded-md bg-surface border border-border text-xs text-muted">
          HertzSync Operator Console · Solana DevNet
        </div>
      </footer>
    </main>
  );
}
