"use client";

import React, { useState } from "react";
import { RpcEndpointInfo } from "./EndpointPanel";

interface ChaosControlsProps {
  endpoints: RpcEndpointInfo[];
  chaosEnabled: boolean;
  onRefresh: () => void;
}

export function ChaosControls({ endpoints, chaosEnabled, onRefresh }: ChaosControlsProps) {
  const [adminKey, setAdminKey] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null);
  const [showBurstCommand, setShowBurstCommand] = useState(false);

  if (!chaosEnabled) {
    return null;
  }

  const applyChaos = async (mode: "down" | "off" | "lie") => {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const targetEndpoints = mode === "lie" ? [endpoints[0]?.url].filter(Boolean) : endpoints.map((e) => e.url);

      for (const ep of targetEndpoints) {
        const res = await fetch("/api/v1/chaos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminKey}`,
          },
          body: JSON.stringify({
            endpoint: ep,
            mode,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message || `Failed to apply chaos (${res.status})`);
        }
      }

      setFeedback({
        message:
          mode === "down"
            ? "Outage mode activated across endpoints (system_state updated). Chain connection paused."
            : mode === "off"
            ? "Network restored across endpoints (system_state updated). Healthy operation resumed."
            : `Endpoint ${endpoints[0]?.url || "1"} set to lie mode (system_state updated).`,
      });
      onRefresh();
    } catch (err: any) {
      setFeedback({
        message: err.message || "Failed to update chaos state.",
        isError: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-surface border border-amber-600/30 rounded-xl p-5 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-2">
            <span>Chaos & Fault Injection</span>
            <span className="text-[10px] bg-amber-950 text-amber-300 px-2 py-0.5 rounded border border-amber-700/50">
              Dev Only
            </span>
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Controls write directly to SQLite <code className="text-amber-300">system_state</code> to alter worker RPC router behavior.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="chaos-admin-key" className="text-xs text-muted">
            Admin Key:
          </label>
          <input
            id="chaos-admin-key"
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-text font-mono w-36 focus:outline-none focus:border-amber-500"
            placeholder="ADMIN_API_KEY"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          onClick={() => applyChaos("down")}
          disabled={isSubmitting}
          className="px-3 py-2 bg-red-950/70 hover:bg-red-900 border border-red-700/60 rounded-lg text-xs font-medium text-red-200 transition-colors disabled:opacity-50 text-center"
        >
          Simulate network outage
        </button>

        <button
          onClick={() => applyChaos("off")}
          disabled={isSubmitting}
          className="px-3 py-2 bg-teal-950/70 hover:bg-teal-900 border border-teal-700/60 rounded-lg text-xs font-medium text-teal-200 transition-colors disabled:opacity-50 text-center"
        >
          Restore network
        </button>

        <button
          onClick={() => applyChaos("lie")}
          disabled={isSubmitting}
          className="px-3 py-2 bg-amber-950/70 hover:bg-amber-900 border border-amber-700/60 rounded-lg text-xs font-medium text-amber-200 transition-colors disabled:opacity-50 text-center"
        >
          Make one endpoint lie
        </button>

        <button
          onClick={() => setShowBurstCommand(!showBurstCommand)}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-lg text-xs font-medium text-slate-200 transition-colors text-center"
        >
          Burst 1,000 events
        </button>
      </div>

      {showBurstCommand && (
        <div className="mt-3 p-3 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300">
          <div className="font-semibold text-text mb-1">Trigger 1,000-Event Burst:</div>
          <p className="text-muted mb-2">
            Per Blueprint safety specifications, high-throughput bursts are dispatched via the simulator CLI command on the host machine:
          </p>
          <div className="bg-black/50 p-2 rounded font-mono text-teal-300 select-all border border-slate-800">
            node node_modules/vite-node/vite-node.mjs scripts/device-sim.ts --mode burst --count 1000
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`mt-3 p-2.5 rounded-lg text-xs font-medium border ${
            feedback.isError
              ? "bg-red-950/60 text-red-300 border-red-800"
              : "bg-teal-950/60 text-teal-300 border-teal-800"
          }`}
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}

