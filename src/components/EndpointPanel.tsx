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
        className: "bg-red-950/60 text-red-300 border-red-700/60",
        dot: "bg-red-400",
      };
    }
    if (ep.chaosMode === "lie") {
      return {
        label: "CHAOS: LYING",
        className: "bg-amber-950/60 text-amber-300 border-amber-700/60",
        dot: "bg-amber-400",
      };
    }
    if (ep.state === "open") {
      return {
        label: "BREAKER OPEN",
        className: "bg-red-950/60 text-red-300 border-red-700/60",
        dot: "bg-red-400",
      };
    }
    if (ep.state === "half_open") {
      return {
        label: "PROBING (HALF-OPEN)",
        className: "bg-amber-950/60 text-amber-300 border-amber-700/60",
        dot: "bg-amber-400",
      };
    }
    return {
      label: "HEALTHY (CLOSED)",
      className: "bg-teal-950/60 text-teal-300 border-teal-700/60",
      dot: "bg-teal-400",
    };
  };

  return (
    <div className="bg-surface border border-slate-800 rounded-xl p-5 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wider">
          RPC Router Endpoints
        </h2>
        <span className="text-xs text-muted font-mono">
          {endpoints.length} configured
        </span>
      </div>

      <div className="space-y-2.5">
        {endpoints.map((ep) => {
          const badge = getBadge(ep);
          let hostname = ep.url;
          try {
            hostname = new URL(ep.url).hostname;
          } catch {}

          return (
            <div
              key={ep.url}
              className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-900 border border-slate-800 rounded-lg gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-text truncate" title={ep.url}>
                  {ep.url}
                </div>
                <div className="text-[11px] text-muted mt-0.5">
                  Host: {hostname} {ep.failures > 0 ? `| Failures: ${ep.failures}` : ""}
                </div>
              </div>
              <div>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border ${badge.className}`}
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
  );
}

