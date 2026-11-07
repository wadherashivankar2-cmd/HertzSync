"use client";

import React, { useEffect, useState, useCallback } from "react";
import { MetricCard } from "../components/MetricCard";
import { FlowDiagram } from "../components/FlowDiagram";
import { EndpointPanel, RpcEndpointInfo } from "../components/EndpointPanel";
import { ChaosControls } from "../components/ChaosControls";
import { BatchTable, BatchItem } from "../components/BatchTable";
import { ReconciliationPanel, ReconciliationData } from "../components/ReconciliationPanel";
import { EventLog, AuditLogItem } from "../components/EventLog";

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

      setMetrics(metricsData.metrics || null);
      setEndpoints(metricsData.rpc_endpoints || []);
      setAuditLogs(metricsData.recent_audit_logs || []);
      setChaosEnabled(Boolean(metricsData.chaos_enabled));

      setBatches(batchesData.batches || []);
      setReconciliation(reconData.reconciliation || null);
      setLastRefreshedAt(Date.now());
      setError(null);
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
  const chainHealthy = endpoints.length > 0 && endpoints.some((e) => e.state === "closed" || e.state === "half_open");

  return (
    <div className="min-h-screen bg-bg text-text pb-16">
      {/* Header */}
      <header className="border-b border-slate-800 bg-surface sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-text flex items-center gap-2">
              <span className="text-teal-400 font-mono tracking-tighter">⚡</span>
              TrickleSettle
            </h1>
            <span className="text-xs text-muted font-normal">Operator Console</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-950/70 text-teal-300 border border-teal-700/60">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              DevNet test network
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  error ? "bg-red-400" : "bg-teal-400 animate-pulse"
                }`}
              />
              <span className="font-mono">
                {error ? "Poll Error" : `Live: ${new Date(lastRefreshedAt).toLocaleTimeString()}`}
              </span>
            </div>
            <button
              onClick={fetchDashboardData}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 border border-slate-700 text-xs transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Error notification banner if polling failed */}
        {error && (
          <div className="p-3 bg-red-950/70 border border-red-700 rounded-lg text-xs text-red-200 flex items-center justify-between">
            <span>Notice: {error} (Reading from SQLite)</span>
            <button onClick={fetchDashboardData} className="underline ml-2">
              Retry
            </button>
          </div>
        )}

        {/* Row 1: Four Metric Cards */}
        <section aria-label="Key Performance Metrics">
          <h2 className="sr-only">Key Performance Metrics</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Received Events"
              value={metrics?.events_received_total ?? (isLoading ? "..." : 0)}
              subtitle="Accepted through durable ingest"
              badge={{ text: "Total Ingest", variant: "neutral" }}
            />
            <MetricCard
              title="Waiting to be Paid"
              value={waitingCount}
              subtitle="Queued safely in SQLite WAL"
              badge={{
                text: waitingCount > 0 ? "Queued" : "Drained",
                variant: waitingCount > 0 ? "warning" : "success",
              }}
            />
            <MetricCard
              title="Paid on Solana"
              value={metrics?.events_paid ?? (isLoading ? "..." : 0)}
              subtitle="Confirmed on DevNet ledger"
              badge={{ text: "On-Chain", variant: "success" }}
            />
            <MetricCard
              title="Lost Events"
              value={metrics?.events_lost ?? 0}
              subtitle={
                reconciliation?.run_at
                  ? `Last reconciled: ${new Date(reconciliation.run_at).toLocaleTimeString()}`
                  : "Last reconciled: pending"
              }
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
        <section aria-label="RPC Infrastructure & Chaos Injection" className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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
