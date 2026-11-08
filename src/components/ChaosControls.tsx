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
    <div className="bg-surface border border-border rounded-xl shadow-lg w-full min-w-0 flex flex-col transition-colors duration-200 box-border overflow-hidden h-full">
      <div className="px-5 py-3.5 bg-[var(--section-header-bg)] border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--blue-accent)]" aria-hidden="true" />
            <span>Chaos & Fault Injection</span>
            <span className="text-[10px] bg-warning-bg text-warning-text px-2 py-0.5 rounded border border-warning-border font-mono font-medium">
              Dev Only
            </span>
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Controls write directly to SQLite <code className="text-info-text">system_state</code> to alter worker RPC router behavior.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="chaos-admin-key" className="text-xs text-muted whitespace-nowrap">
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

      <div className="p-5 flex flex-col justify-between flex-1 gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3">
          {/* Primary Action Button 1: Simulate Outage (CORAL ACCENT) */}
          <button
            onClick={() => applyChaos("down")}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 py-2.5 bg-danger-bg hover:opacity-90 border border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)] rounded-lg text-sm font-semibold text-danger-text transition-all btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50 text-center flex items-center justify-center"
          >
            Simulate Outage
          </button>

          {/* Primary Action Button 2: Restore Network (CORAL ACCENT) */}
          <button
            onClick={() => applyChaos("off")}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 py-2.5 bg-success-bg hover:opacity-90 border border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)] rounded-lg text-sm font-semibold text-success-text transition-all btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50 text-center flex items-center justify-center"
          >
            Restore Network
          </button>

          {/* Secondary Action Button 3: Make one endpoint lie (STANDARD BORDER, NO CORAL) */}
          <button
            onClick={() => applyChaos("lie")}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 py-2.5 bg-surface-alt hover:bg-surface-hover border border-border rounded-lg text-sm font-semibold text-warning-text transition-all btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text disabled:opacity-50 text-center flex items-center justify-center"
          >
            Make one endpoint lie
          </button>

          {/* Secondary Action Button 4: Burst 1,000 events (STANDARD BORDER, NO CORAL) */}
          <button
            onClick={() => setShowBurstCommand((prev) => !prev)}
            className="min-h-[44px] px-4 py-2.5 bg-surface-alt hover:bg-surface-hover border border-border rounded-lg text-sm font-semibold text-text transition-all btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text text-center flex items-center justify-center"
          >
            Burst 1,000 events
          </button>
        </div>

        {showBurstCommand && (
          <div className="p-3.5 bg-surface-alt border border-border rounded-lg text-xs font-mono text-text">
            <div className="text-xs text-muted mb-1.5">Run in a separate terminal:</div>
            <code className="text-info-text break-all select-all text-xs">
              npm run sim -- --mode=burst --count=1000 --interval=0
            </code>
          </div>
        )}

        {feedback && (
          <div
            className={`p-3.5 rounded-lg text-xs border ${
              feedback.isError
                ? "bg-danger-bg border-danger-border text-danger-text"
                : "bg-success-bg border-success-border text-success-text"
            }`}
          >
            {feedback.message}
          </div>
        )}
      </div>
    </div>
  );
}
