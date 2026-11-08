import React from "react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-bg text-text flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-surface border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-teal-950/60 border border-teal-500/30 text-accent mb-6">
          <span className="text-2xl font-black font-mono">404</span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-text mb-2">
          Page Not Found
        </h1>

        <p className="text-sm text-muted mb-8 leading-relaxed">
          The requested route does not exist. Return to the TrickleSettle operator dashboard to monitor live micro-settlement events and telemetry.
        </p>

        <Link
          href="/"
          className="inline-flex items-center justify-center w-full px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-slate-950 font-semibold text-sm transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 focus:ring-offset-slate-900"
        >
          Return to Dashboard
        </Link>
      </div>
    </main>
  );
}

