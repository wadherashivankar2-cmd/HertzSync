"use client";

import React from "react";

interface FlowDiagramProps {
  chainHealthy: boolean;
  waitingCount: number;
  paidCount: number;
}

export function FlowDiagram({ chainHealthy, waitingCount, paidCount }: FlowDiagramProps) {
  return (
    <div className="bg-surface border border-slate-800 rounded-xl p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wider">
          Settlement Pipeline Flow
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
            chainHealthy
              ? "bg-teal-950/50 text-teal-300 border-teal-700/50"
              : "bg-red-950/50 text-red-300 border-red-700/50"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${chainHealthy ? "bg-teal-400" : "bg-red-400"}`}
          />
          {chainHealthy ? "Network Connected" : "Network Disconnected / Down"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
        {/* Node 1: Devices */}
        <div className="bg-slate-900 border border-slate-700/80 rounded-lg p-4 text-center">
          <div className="text-xs uppercase tracking-wider text-muted font-medium mb-1">
            Input Sources
          </div>
          <div className="text-base font-bold text-text">Edge Devices</div>
          <div className="text-xs text-muted mt-1">Ed25519 Signed Events</div>
        </div>

        {/* Connector 1: Ingest (always active) */}
        <div className="flex flex-col items-center justify-center py-2" aria-hidden="true">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse-flow" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse-flow" style={{ animationDelay: "250ms" }} />
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse-flow" style={{ animationDelay: "500ms" }} />
          </div>
          <span className="text-[11px] text-muted font-mono mt-1">Durable Ingest</span>
        </div>

        {/* Node 2: Recorded Safely (SQLite WAL) */}
        <div className="bg-slate-900 border border-amber-600/40 rounded-lg p-4 text-center relative overflow-hidden">
          <div className="text-xs uppercase tracking-wider text-amber-400 font-medium mb-1">
            Durable Queue
          </div>
          <div className="text-base font-bold text-text">Recorded Safely</div>
          <div className="text-xs text-muted mt-1">
            <span className="font-mono text-amber-300 font-semibold">{waitingCount.toLocaleString()}</span> waiting in SQLite
          </div>
        </div>

        {/* Connector 2: Worker to Chain (Pauses if chain is down) */}
        <div className="flex flex-col items-center justify-center py-2" aria-hidden="true">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                chainHealthy ? "bg-teal-400 animate-pulse-flow" : "bg-red-400/50"
              }`}
              style={{ animationDelay: "0ms" }}
            />
            <span
              className={`w-2 h-2 rounded-full ${
                chainHealthy ? "bg-teal-400 animate-pulse-flow" : "bg-red-400/50"
              }`}
              style={{ animationDelay: "250ms" }}
            />
            <span
              className={`w-2 h-2 rounded-full ${
                chainHealthy ? "bg-teal-400 animate-pulse-flow" : "bg-red-400/50"
              }`}
              style={{ animationDelay: "500ms" }}
            />
          </div>
          <span
            className={`text-[11px] font-mono mt-1 ${
              chainHealthy ? "text-muted" : "text-red-400 font-semibold"
            }`}
          >
            {chainHealthy ? "Batch Settle" : "Chain Outage (Paused)"}
          </span>
        </div>

        {/* Node 3: Paid on Solana */}
        <div className="bg-slate-900 border border-teal-600/40 rounded-lg p-4 text-center">
          <div className="text-xs uppercase tracking-wider text-teal-400 font-medium mb-1">
            Settlement
          </div>
          <div className="text-base font-bold text-text">Paid on Solana</div>
          <div className="text-xs text-muted mt-1">
            <span className="font-mono text-teal-300 font-semibold">{paidCount.toLocaleString()}</span> confirmed on DevNet
          </div>
        </div>
      </div>
    </div>
  );
}

