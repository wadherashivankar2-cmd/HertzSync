import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Welcome | HertzSync",
  description: "DePIN micro-settlement reliability layer on Solana DevNet",
};

export default function WelcomePage() {
  return (
    <div
      className="relative min-h-screen flex flex-col justify-between box-border w-full max-w-full overflow-x-hidden selection:bg-[#1E293B] selection:text-[#F1F5F9]"
      style={{
        backgroundColor: "#0A0F1F",
        color: "#F1F5F9",
      }}
    >
      {/* Faint dot grid across the full page: pattern in #1E2A4A at 40% opacity, pointer-events none */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(30, 42, 74, 0.40) 1.5px, transparent 1.5px)",
          backgroundSize: "24px 24px",
        }}
        aria-hidden="true"
      />

      {/* Full-width header bar with HertzSync on the left and Solana DevNet on the right, at 20px */}
      <header
        className="w-full box-border border-b border-[#FF8A4C] bg-[#0A0F1F] shrink-0 z-20"
      >
        <div className="w-full px-8 py-4 flex items-center justify-between gap-4 box-border">
          <Link
            href="/"
            className="text-[20px] font-bold tracking-tight text-[#F1F5F9] flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8A4C] rounded p-1"
          >
            <span className="text-amber-400 font-mono tracking-tighter" aria-hidden="true">
              ⚡
            </span>
            <span>HertzSync</span>
          </Link>
          <span className="text-[20px] font-mono text-[#94A3B8]">Solana DevNet</span>
        </div>
      </header>

      {/* Main Hero: vertically and horizontally centered in viewport */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-8 py-10 text-center w-full max-w-7xl mx-auto box-border">
        {/* Badge above headline */}
        <div className="mb-6">
          <span className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-[14px] font-semibold bg-[rgba(16,185,129,0.12)] text-[#6EE7B7] border border-[rgba(16,185,129,0.35)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#6EE7B7]" aria-hidden="true" />
            DePIN micro-settlement · Solana DevNet
          </span>
        </div>

        {/* Headline: two deliberate lines, font weight 600, 96px on desktop, 44px on mobile, -0.02em */}
        <h1 className="text-[44px] sm:text-[68px] lg:text-[96px] font-semibold text-[#F1F5F9] tracking-[-0.02em] leading-[1.05] mb-6">
          <span className="block">Nothing lost.</span>
          <span className="block">Nothing paid twice.</span>
        </h1>

        {/* Supporting text: max 56ch, 22px on desktop */}
        <p className="text-lg sm:text-[22px] text-[#94A3B8] max-w-[56ch] mx-auto mb-8 leading-relaxed">
          HertzSync queues signed device events durably, settles them in batches on Solana DevNet, and
          proves every one is accounted for.
        </p>

        {/* Row of four coloured boxes, each with a short USP and coloured top bar */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-left my-8">
          {/* Box 1: Durable queue (Coral) */}
          <div className="bg-[#111A33] border border-[#FF8A4C]/40 rounded-xl overflow-hidden flex flex-col justify-between shadow-lg">
            <div className="h-1.5 w-full bg-[#FF8A4C]" aria-hidden="true" />
            <div className="p-6 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF8A4C]" aria-hidden="true" />
                  <h3 className="text-[1.125rem] font-bold text-[#FF8A4C] tracking-wide">Durable queue</h3>
                </div>
                <p className="text-[#94A3B8] text-[1rem] leading-relaxed mt-2">
                  Events are saved before the network is touched.
                </p>
              </div>
            </div>
          </div>

          {/* Box 2: Batch settlement (Blue) */}
          <div className="bg-[#111A33] border border-[#38BDF8]/40 rounded-xl overflow-hidden flex flex-col justify-between shadow-lg">
            <div className="h-1.5 w-full bg-[#38BDF8]" aria-hidden="true" />
            <div className="p-6 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#38BDF8]" aria-hidden="true" />
                  <h3 className="text-[1.125rem] font-bold text-[#38BDF8] tracking-wide">Batch settlement</h3>
                </div>
                <p className="text-[#94A3B8] text-[1rem] leading-relaxed mt-2">
                  Many small payments become one Solana transaction.
                </p>
              </div>
            </div>
          </div>

          {/* Box 3: Outage resilience (Green) */}
          <div className="bg-[#111A33] border border-[#10B981]/40 rounded-xl overflow-hidden flex flex-col justify-between shadow-lg">
            <div className="h-1.5 w-full bg-[#10B981]" aria-hidden="true" />
            <div className="p-6 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" aria-hidden="true" />
                  <h3 className="text-[1.125rem] font-bold text-[#10B981] tracking-wide">Outage resilience</h3>
                </div>
                <p className="text-[#94A3B8] text-[1rem] leading-relaxed mt-2">
                  The network can fail. Nothing is dropped.
                </p>
              </div>
            </div>
          </div>

          {/* Box 4: Proof (Amber) */}
          <div className="bg-[#111A33] border border-[#F59E0B]/40 rounded-xl overflow-hidden flex flex-col justify-between shadow-lg">
            <div className="h-1.5 w-full bg-[#F59E0B]" aria-hidden="true" />
            <div className="p-6 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" aria-hidden="true" />
                  <h3 className="text-[1.125rem] font-bold text-[#F59E0B] tracking-wide">Proof</h3>
                </div>
                <p className="text-[#94A3B8] text-[1rem] leading-relaxed mt-2">
                  Every event is reconciled: generated equals paid plus waiting.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions: primary coral button with dark text, secondary muted link, 16px text */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto mt-4">
          <Link
            href="/dashboard"
            className="min-h-[44px] min-w-[200px] px-6 py-3 rounded-lg bg-[#FF8A4C] hover:bg-[#ff9a63] text-[#0A0F1F] font-semibold text-[16px] btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8A4C] inline-flex items-center justify-center transition-all"
          >
            Open operator console
          </Link>

          <a
            href="https://github.com/wadherashivankar2-cmd/HertzSync#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] px-4 py-3 text-[#94A3B8] hover:text-[#F1F5F9] font-medium text-[16px] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#94A3B8] inline-flex items-center justify-center transition-colors"
          >
            Read the README
          </a>
        </div>
      </main>

      {/* Disclaimer: at the bottom, muted, 12px */}
      <footer className="w-full pb-8 pt-4 px-6 text-center shrink-0 z-10">
        <p className="text-[12px] text-[#94A3B8] leading-normal max-w-lg mx-auto">
          Demo access, no account required. DevNet prototype, not audited, not for real funds.
        </p>
      </footer>
    </div>
  );
}
