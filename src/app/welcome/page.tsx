import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Welcome | HertzSync",
  description: "DePIN micro-settlement reliability layer on Solana DevNet",
};

export default function WelcomePage() {
  return (
    <div className="relative min-h-screen bg-bg text-text flex flex-col justify-between box-border w-full max-w-full overflow-x-hidden selection:bg-surface-hover selection:text-text">
      {/* Top subtle blue gradient band across header */}
      <header
        className="border-b border-border sticky top-0 z-20 w-full box-border"
        style={{
          background:
            "linear-gradient(to right, rgba(27, 42, 107, 0.35) 0%, rgba(27, 42, 107, 0.15) 50%, transparent 100%), var(--surface)",
        }}
      >
        <div className="w-full max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4 box-border">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-text flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text rounded p-1"
          >
            <span className="text-amber-400 font-mono tracking-tighter" aria-hidden="true">
              ⚡
            </span>
            HertzSync
          </Link>
          <span className="text-xs font-mono text-muted">Solana DevNet</span>
        </div>
      </header>

      {/* Main Hero Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-16 text-center max-w-3xl mx-auto my-auto box-border">
        {/* Small Badge */}
        <div className="mb-6">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-success-bg text-success-text border border-success-border">
            <span className="w-1.5 h-1.5 rounded-full bg-success-text" aria-hidden="true" />
            DePIN micro-settlement · Solana DevNet
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-text mb-5 leading-tight">
          Nothing lost. Nothing paid twice.
        </h1>

        {/* Subtitle / Descriptive Line */}
        <p className="text-base sm:text-lg text-muted max-w-2xl mb-8 leading-relaxed">
          HertzSync queues signed device events durably, settles them in batches on Solana DevNet, and
          proves every one is accounted for.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-8 w-full sm:w-auto">
          <Link
            href="/"
            className="min-h-[44px] min-w-[200px] px-6 py-3 rounded-lg bg-surface hover:bg-surface-hover text-text border border-border font-semibold text-sm btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text inline-flex items-center justify-center transition-all"
          >
            Open operator console
          </Link>

          <a
            href="https://github.com/wadherashivankar2-cmd/HertzSync#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] min-w-[160px] px-4 py-3 text-muted hover:text-text font-medium text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text inline-flex items-center justify-center transition-colors"
          >
            Read the README
          </a>
        </div>

        {/* Note */}
        <p className="text-xs text-muted max-w-lg mx-auto leading-normal">
          Demo access, no account required. DevNet prototype, not audited, not for real funds.
        </p>
      </main>

      {/* Subtle blue gradient band across the bottom 200px of the page */}
      <div
        className="absolute inset-x-0 bottom-0 h-[200px] pointer-events-none z-0"
        aria-hidden="true"
        style={{
          background: "linear-gradient(to top, rgba(27, 42, 107, 0.35) 0%, transparent 100%)",
        }}
      />
    </div>
  );
}

