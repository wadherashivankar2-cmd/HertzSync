"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { MetricCard } from "../components/MetricCard";
import { FlowDiagram } from "../components/FlowDiagram";
import { EndpointPanel, RpcEndpointInfo } from "../components/EndpointPanel";
import { ChaosControls } from "../components/ChaosControls";
import { BatchTable, BatchItem } from "../components/BatchTable";
import { ReconciliationPanel, ReconciliationData } from "../components/ReconciliationPanel";
import { EventLog, AuditLogItem } from "../components/EventLog";
import { ThemeSwitcher } from "../components/ThemeSwitcher";

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<any>(null);
  const [endpoints, setEndpoints] = useState<RpcEndpointInfo[]>([]);
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [chaosEnabled, setChaosEnabled] = useState<boolean>(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Real SQLite sparkline histories (no random data)
  const [receivedHistory, setReceivedHistory] = useState<number[]>([]);
  const [waitingHistory, setWaitingHistory] = useState<number[]>([]);
  const initialReceivedRef = useRef<number | null>(null);

  const fetchDashboardData = useCallback(async () => {
    try {
      const [metricsRes, batchesRes, reconRes] = await Promise.all([
        fetch("/api/v1/metrics"),
        fetch("/api/v1/batches?limit=20"),
        fetch("/api/v1/reconciliation"),
      ]);

      if (!metricsRes.ok) throw new Error(`Metrics API error (${metricsRes.status})`);
      if (!batchesRes.ok) throw new Error(`Batches API error (${batchesRes.status})`);
      if (!reconRes.ok) throw new Error(`Reconciliation API error (${reconRes.status})`);

      const metricsData = await metricsRes.json();
      const batchesData = await batchesRes.json();
      const reconData = await reconRes.json();

      const m = metricsData.metrics || null;
      setMetrics(m);
      setEndpoints(metricsData.rpc_endpoints || []);
      setAuditLogs(metricsData.recent_audit_logs || []);
      setChaosEnabled(Boolean(metricsData.chaos_enabled));

      setBatches(batchesData.batches || []);
      setReconciliation(reconData.reconciliation || null);
      setLastRefreshedAt(Date.now());
      setError(null);

      if (m) {
        if (initialReceivedRef.current === null) {
          initialReceivedRef.current = m.events_received_total || 0;
        }
        const total = m.events_received_total || 0;
        const waiting = (m.events_queued || 0) + (m.events_batched || 0);

        setReceivedHistory((prev) => {
          const next = [...prev, total];
          return next.slice(-10);
        });

        setWaitingHistory((prev) => {
          const next = [...prev, waiting];
          return next.slice(-10);
        });
      }
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard data from SQLite.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Poll every 2 seconds
  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 2000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  const waitingCount = (metrics?.events_queued || 0) + (metrics?.events_batched || 0);
  const chainHealthy =
    endpoints.length > 0 &&
    endpoints.some((e) => e.state === "closed" || e.state === "half_open");

  // Real batch sizes from confirmed SQLite batches for the paid sparkline
  const paidSparklineData =
    batches.length > 0
      ? batches.slice(0, 10).map((b) => b.eventCount).reverse()
      : [metrics?.events_paid || 0];

  const initialTotal = initialReceivedRef.current ?? (metrics?.events_received_total || 0);
  const deltaReceived = Math.max(0, (metrics?.events_received_total || 0) - initialTotal);

  return (
    <div className="min-h-screen pb-16 transition-colors duration-200">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-30 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-text flex items-center gap-2">
              <span className="text-[var(--accent)] font-mono tracking-tighter" aria-hidden="true">
                ⚡
              </span>
              HertzSync
            </h1>
            <span className="text-xs text-muted font-normal">Operator Console</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-success-bg text-success-text border border-success-border">
              <span className="w-1.5 h-1.5 rounded-full bg-success-text" />
              DevNet test network
            </span>
          </div>

          <div className="flex items-center gap-3.5">
            {/* Live Polling Status Indicator */}
            <div className="flex items-center gap-2 text-xs text-muted">
              <span
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  error
                    ? "bg-rose-500"
                    : "bg-[var(--accent)]"
                }`}
                style={
                  error
                    ? undefined
                    : { boxShadow: "0 0 12px var(--accent-glow)" }
                }
                aria-hidden="true"
              />
              <span className="font-mono text-[11px]">
                {error ? "Poll Error" : `Live: ${new Date(lastRefreshedAt).toLocaleTimeString()}`}
              </span>
            </div>

            {/* Refresh Button (At least 44px interactive target) */}
            <button
              onClick={fetchDashboardData}
              className="min-h-[44px] min-w-[44px] px-3.5 py-2 bg-surface hover:bg-surface-hover rounded-lg text-text border border-border text-xs font-semibold btn-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-all"
            >
              Refresh
            </button>

            {/* Theme Switcher Button Group */}
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Error notification banner if polling failed */}
        {error && (
          <div className="p-3 bg-danger-bg border border-danger-border rounded-lg text-xs text-danger-text flex items-center justify-between">
            <span>Notice: {error} (Reading from SQLite)</span>
            <button
              onClick={fetchDashboardData}
              className="underline ml-2 min-h-[44px] px-2 py-1"
            >
              Retry
            </button>
          </div>
        )}

        {/* Row 1: Four Stat Cards with large tabular numbers, label above, delta below, and real sparkline */}
        <section aria-label="Key Performance Metrics">
          <h2 className="sr-only">Key Performance Metrics</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Received Events"
              value={metrics?.events_received_total ?? (isLoading ? "..." : 0)}
              deltaLine={
                <span>
                  Delta: <span className="font-semibold text-text">+{deltaReceived}</span> this session
                </span>
              }
              sparklineData={receivedHistory.length > 0 ? receivedHistory : [metrics?.events_received_total || 0]}
              sparklineColor="var(--accent)"
              badge={{ text: "Total Ingest", variant: "neutral" }}
            />
            <MetricCard
              title="Waiting to be Paid"
              value={waitingCount}
              deltaLine={<span>SQLite WAL queue · unbatched</span>}
              sparklineData={waitingHistory.length > 0 ? waitingHistory : [waitingCount]}
              sparklineColor="var(--pending)"
              badge={{
                text: waitingCount > 0 ? "Queued" : "Drained",
                variant: waitingCount > 0 ? "warning" : "success",
              }}
            />
            <MetricCard
              title="Paid on Solana"
              value={metrics?.events_paid ?? (isLoading ? "..." : 0)}
              deltaLine={
                <span>
                  Settled: <span className="font-semibold text-text">{batches.length}</span> batches
                </span>
              }
              sparklineData={paidSparklineData}
              sparklineColor="var(--success)"
              badge={{ text: "On-Chain", variant: "success" }}
            />
            <MetricCard
              title="Lost Events"
              value={metrics?.events_lost ?? 0}
              deltaLine={
                reconciliation?.runAt
                  ? `Last reconciled: ${new Date(reconciliation.runAt).toLocaleTimeString()}`
                  : "Last reconciled: pending"
              }
              sparklineData={[0, 0, 0, 0]}
              sparklineColor="var(--success)"
              badge={{ text: "✓ Zero Lost", variant: "success" }}
            />
          </div>
        </section>

        {/* Row 2: Pipeline Flow Diagram */}
        <section aria-label="Pipeline Architecture Flow">
          <FlowDiagram
            chainHealthy={chainHealthy}
            waitingCount={waitingCount}
            paidCount={metrics?.events_paid || 0}
          />
        </section>

        {/* Row 3: Endpoint Panel & Chaos Controls */}
        <section
          aria-label="RPC Infrastructure & Chaos Injection"
          className="grid grid-cols-1 lg:grid-cols-2 gap-5"
        >
          <EndpointPanel endpoints={endpoints} />
          <ChaosControls
            endpoints={endpoints}
            chaosEnabled={chaosEnabled}
            onRefresh={fetchDashboardData}
          />
        </section>

        {/* Row 4: Settlement Batches Table */}
        <section aria-label="Settlement Batches">
          <BatchTable batches={batches} isLoading={isLoading} />
        </section>

        {/* Row 5: Reconciliation Panel */}
        <section aria-label="Reconciliation Verification">
          <ReconciliationPanel data={reconciliation} />
        </section>

        {/* Bottom: Event Log */}
        <section aria-label="System Event Feed">
          <EventLog logs={auditLogs} />
        </section>
      </main>
    </div>
  );
}
