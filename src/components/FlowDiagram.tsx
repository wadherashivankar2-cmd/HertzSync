"use client";

import React from "react";

interface FlowDiagramProps {
  chainHealthy: boolean;
  waitingCount: number;
  paidCount: number;
}

export function FlowDiagram({ chainHealthy, waitingCount, paidCount }: FlowDiagramProps) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 shadow-lg h-full w-full min-w-0 flex flex-col justify-between transition-colors duration-200 box-border">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wider">
          Settlement Pipeline Flow
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
            chainHealthy
              ? "bg-success-bg text-success-text border-success-border"
              : "bg-danger-bg text-danger-text border-danger-border"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              chainHealthy ? "bg-success-text" : "bg-danger-text"
            }`}
          />
          {chainHealthy ? "Network Connected" : "Network Disconnected / Down"}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center my-auto">
        {/* Node 1: Devices */}
        <div className="bg-surface-alt border border-border rounded-lg p-2.5 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted font-medium mb-0.5">
            Input Sources
          </div>
          <div className="text-xs sm:text-sm font-bold text-text truncate">Edge Devices</div>
          <div className="text-[10px] text-muted mt-0.5 truncate">Ed25519 Signed</div>
        </div>

        {/* Connector 1: Ingest (always active) */}
        <div className="flex flex-col items-center justify-center py-1" aria-hidden="true">
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full bg-success-text animate-pulse-flow"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="w-2 h-2 rounded-full bg-success-text animate-pulse-flow"
              style={{ animationDelay: "250ms" }}
            />
            <span
              className="w-2 h-2 rounded-full bg-success-text animate-pulse-flow"
              style={{ animationDelay: "500ms" }}
            />
          </div>
          <span className="text-[10px] text-muted font-mono mt-1 whitespace-nowrap">Durable Ingest</span>
        </div>

        {/* Node 2: Recorded Safely (SQLite WAL) */}
        <div className="bg-surface-alt border border-warning-border rounded-lg p-2.5 text-center relative overflow-hidden">
          <div className="text-[10px] uppercase tracking-wider text-warning-text font-medium mb-0.5">
            Durable Queue
          </div>
          <div className="text-xs sm:text-sm font-bold text-text truncate">Recorded Safely</div>
          <div className="text-[10px] text-muted mt-0.5 truncate">
            <span className="font-mono text-warning-text font-semibold">
              {waitingCount.toLocaleString()}
            </span>{" "}
            in SQLite
          </div>
        </div>

        {/* Connector 2: Worker to Chain (Pauses if chain is down) */}
        <div className="flex flex-col items-center justify-center py-1" aria-hidden="true">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                chainHealthy
                  ? "bg-success-text animate-pulse-flow"
                  : "bg-danger-text opacity-50"
              }`}
              style={{ animationDelay: "0ms" }}
            />
            <span
              className={`w-2 h-2 rounded-full ${
                chainHealthy
                  ? "bg-success-text animate-pulse-flow"
                  : "bg-danger-text opacity-50"
              }`}
              style={{ animationDelay: "250ms" }}
            />
            <span
              className={`w-2 h-2 rounded-full ${
                chainHealthy
                  ? "bg-success-text animate-pulse-flow"
                  : "bg-danger-text opacity-50"
              }`}
              style={{ animationDelay: "500ms" }}
            />
          </div>
          <span
            className={`text-[10px] font-mono mt-1 whitespace-nowrap ${
              chainHealthy ? "text-muted" : "text-danger-text font-semibold"
            }`}
          >
            {chainHealthy ? "Batch Settle" : "Paused"}
          </span>
        </div>

        {/* Node 3: Paid on Solana */}
        <div className="bg-surface-alt border border-success-border rounded-lg p-2.5 text-center">
          <div className="text-[10px] uppercase tracking-wider text-success-text font-medium mb-0.5">
            Settlement
          </div>
          <div className="text-xs sm:text-sm font-bold text-text truncate">Paid on Solana</div>
          <div className="text-[10px] text-muted mt-0.5 truncate">
            <span className="font-mono text-success-text font-semibold">
              {paidCount.toLocaleString()}
            </span>{" "}
            confirmed
          </div>
        </div>
      </div>
    </div>
  );
}
