"use client";

import React from "react";

export interface RpcEndpointInfo {
  url: string;
  state: string; // "closed" | "open" | "half_open" | "down"
  failures: number;
  chaosMode: string;
}

interface EndpointPanelProps {
  endpoints: RpcEndpointInfo[];
}

export function EndpointPanel({ endpoints }: EndpointPanelProps) {
  const getBadge = (ep: RpcEndpointInfo) => {
    if (ep.chaosMode === "down" || ep.state === "down") {
      return {
        label: "CHAOS: DOWN",
        className: "bg-danger-bg text-danger-text border-danger-border",
        dot: "bg-danger-text",
      };
    }
    if (ep.chaosMode === "lie") {
      return {
        label: "CHAOS: LYING",
        className: "bg-warning-bg text-warning-text border-warning-border",
        dot: "bg-warning-text",
      };
    }
    if (ep.state === "open") {
      return {
        label: "BREAKER OPEN",
        className: "bg-danger-bg text-danger-text border-danger-border",
        dot: "bg-danger-text",
      };
    }
    if (ep.state === "half_open") {
      return {
        label: "PROBING (HALF-OPEN)",
        className: "bg-warning-bg text-warning-text border-warning-border",
        dot: "bg-warning-text",
      };
    }
    return {
      label: "HEALTHY (CLOSED)",
      className: "bg-success-bg text-success-text border-success-border",
      dot: "bg-success-text",
    };
  };

  return (
    <div className="bg-surface border border-border rounded-xl shadow-lg w-full min-w-0 flex flex-col transition-colors duration-200 box-border overflow-hidden h-full">
      <div className="px-5 py-3.5 bg-[var(--section-header-bg)] border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--blue-accent)]" aria-hidden="true" />
            RPC Router Endpoints
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Circuit breakers and health status for Solana DevNet RPCs
          </p>
        </div>
        <span className="text-xs text-muted font-mono">
          {endpoints.length} configured
        </span>
      </div>

      <div className="p-5">
        <div className="space-y-3">
          {endpoints.map((ep) => {
            const badge = getBadge(ep);
            let hostname = ep.url;
            try {
              hostname = new URL(ep.url).hostname;
            } catch {}

            return (
              <div
                key={ep.url}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-surface-alt border border-border rounded-lg gap-2 transition-colors duration-200"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-mono text-text truncate" title={ep.url}>
                    {ep.url}
                  </div>
                  <div className="text-xs text-muted mt-1">
                    Host: {hostname} {ep.failures > 0 ? `| Failures: ${ep.failures}` : ""}
                  </div>
                </div>
                <div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${badge.className}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                    {badge.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
