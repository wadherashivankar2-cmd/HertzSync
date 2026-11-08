"use client";

import React from "react";

interface FlowDiagramProps {
  chainHealthy: boolean;
  waitingCount: number;
  paidCount: number;
}

export function FlowDiagram({ chainHealthy, waitingCount, paidCount }: FlowDiagramProps) {
  return (
    <div className="bg-surface border border-border rounded-xl shadow-lg w-full min-w-0 flex flex-col transition-colors duration-200 box-border overflow-hidden h-full">
      <div className="px-5 py-3.5 bg-[var(--section-header-bg)] border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wider flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--blue-accent)]" aria-hidden="true" />
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

      <div className="p-5 flex flex-col justify-between flex-1 gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center my-auto">
          {/* Node 1: Devices */}
          <div className="bg-surface-alt border border-border rounded-lg px-2 py-3 text-center">
            <div className="text-[11px] uppercase tracking-wider text-muted font-medium mb-1">
              Input Sources
            </div>
            <div className="text-xs sm:text-sm font-bold text-text leading-tight">Edge Devices</div>
            <div className="text-[11px] text-muted mt-0.5">Ed25519 Signed</div>
          </div>

          {/* Connector 1: Ingest (always active) */}
          <div className="flex flex-col items-center justify-center py-1" aria-hidden="true">
            <div className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full bg-success-text animate-pulse-flow"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-success-text animate-pulse-flow"
                style={{ animationDelay: "250ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-success-text animate-pulse-flow"
                style={{ animationDelay: "500ms" }}
              />
            </div>
            <span className="text-[11px] text-muted font-mono mt-1 whitespace-nowrap">Durable Ingest</span>
          </div>

          {/* Node 2: Recorded Safely (SQLite WAL) */}
          <div className="bg-surface-alt border border-warning-border rounded-lg px-2 py-3 text-center relative overflow-hidden">
            <div className="text-[11px] uppercase tracking-wider text-warning-text font-medium mb-1">
              Durable Queue
            </div>
            <div className="text-xs sm:text-sm font-bold text-text leading-tight">Recorded Safely</div>
            <div className="text-[11px] text-muted mt-0.5">
              <span className="font-mono text-warning-text font-semibold">
                {waitingCount.toLocaleString()}
              </span>{" "}
              in SQLite
            </div>
          </div>

          {/* Connector 2: Worker to Chain (Pauses if chain is down) */}
          <div className="flex flex-col items-center justify-center py-1" aria-hidden="true">
            <div className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  chainHealthy
                    ? "bg-success-text animate-pulse-flow"
                    : "bg-danger-text opacity-50"
                }`}
                style={{ animationDelay: "0ms" }}
              />
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  chainHealthy
                    ? "bg-success-text animate-pulse-flow"
                    : "bg-danger-text opacity-50"
                }`}
                style={{ animationDelay: "250ms" }}
              />
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  chainHealthy
                    ? "bg-success-text animate-pulse-flow"
                    : "bg-danger-text opacity-50"
                }`}
                style={{ animationDelay: "500ms" }}
              />
            </div>
            <span
              className={`text-[11px] font-mono mt-1 whitespace-nowrap ${
                chainHealthy ? "text-muted" : "text-danger-text font-semibold"
              }`}
            >
              {chainHealthy ? "Batch Settle" : "Paused"}
            </span>
          </div>

          {/* Node 3: Paid on Solana */}
          <div className="bg-surface-alt border border-success-border rounded-lg px-2 py-3 text-center">
            <div className="text-[11px] uppercase tracking-wider text-success-text font-medium mb-1">
              Settlement
            </div>
            <div className="text-xs sm:text-sm font-bold text-text leading-tight">Paid on Solana</div>
            <div className="text-[11px] text-muted mt-0.5">
              <span className="font-mono text-success-text font-semibold">
                {paidCount.toLocaleString()}
              </span>{" "}
              confirmed
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
