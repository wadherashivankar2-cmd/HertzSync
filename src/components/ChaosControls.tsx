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
    <div className="bg-surface border border-border rounded-xl p-5 shadow-lg transition-colors duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-warning-text uppercase tracking-wider flex items-center gap-2">
            <span>Chaos & Fault Injection</span>
            <span className="text-[10px] bg-warning-bg text-warning-text px-2 py-0.5 rounded border border-warning-border">
              Dev Only
            </span>
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Controls write directly to SQLite <code className="text-[var(--accent)]">system_state</code> to alter worker RPC router behavior.
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
            className="min-h-[44px] bg-surface-alt border border-border rounded px-3 py-1.5 text-xs text-text font-mono w-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            placeholder="ADMIN_API_KEY"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          onClick={() => applyChaos("down")}
          disabled={isSubmitting}
          className="min-h-[44px] px-3.5 py-2.5 bg-danger-bg hover:opacity-90 border border-danger-border rounded-lg text-xs font-semibold text-danger-text transition-all btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50 text-center flex items-center justify-center"
        >
          Simulate Outage
        </button>

        <button
          onClick={() => applyChaos("off")}
          disabled={isSubmitting}
          style={{ boxShadow: "0 0 20px 0 var(--accent-glow)" }}
          className="min-h-[44px] px-3.5 py-2.5 bg-success-bg hover:opacity-90 border border-success-border rounded-lg text-xs font-semibold text-success-text transition-all btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50 text-center flex items-center justify-center"
        >
          Restore Network
        </button>

        <button
          onClick={() => applyChaos("lie")}
          disabled={isSubmitting}
          className="min-h-[44px] px-3.5 py-2.5 bg-warning-bg hover:opacity-90 border border-warning-border rounded-lg text-xs font-semibold text-warning-text transition-all btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50 text-center flex items-center justify-center"
        >
          Force Lying RPC
        </button>

        <button
          onClick={() => setShowBurstCommand((prev) => !prev)}
          className="min-h-[44px] px-3.5 py-2.5 bg-surface-alt hover:bg-surface-hover border border-border rounded-lg text-xs font-semibold text-text transition-all btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] text-center flex items-center justify-center"
        >
          Burst 1,000 CLI
        </button>
      </div>

      {showBurstCommand && (
        <div className="mt-3 p-3 bg-surface-alt border border-border rounded-lg text-xs font-mono text-text">
          <div className="text-[11px] text-muted mb-1">Run in a separate terminal:</div>
          <code className="text-[var(--accent)] break-all select-all">
            npm run sim -- --mode=burst --count=1000 --interval=0
          </code>
        </div>
      )}

      {feedback && (
        <div
          className={`mt-3 p-3 rounded-lg text-xs border ${
            feedback.isError
              ? "bg-danger-bg border-danger-border text-danger-text"
              : "bg-success-bg border-success-border text-success-text"
          }`}
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}
