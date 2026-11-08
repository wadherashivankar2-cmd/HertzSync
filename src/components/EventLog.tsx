"use client";

import React from "react";

export interface AuditLogItem {
  id: number;
  at: number;
  actor: string;
  action: string;
  detail: Record<string, any>;
}

interface EventLogProps {
  logs: AuditLogItem[];
}

export function EventLog({ logs }: EventLogProps) {
  function formatLogPlainLanguage(log: AuditLogItem): string {
    const time = new Date(log.at).toLocaleTimeString();
    switch (log.action) {
      case "new_epoch_registered":
        return `[${time}] Device ${log.detail.deviceId || "unknown"} registered epoch ${log.detail.epoch} (clean reset acknowledged)`;
      case "event_conflict":
        return `[${time}] CONFLICT REJECTED: Device ${log.detail.deviceId} attempted sequence re-use with differing payload`;
      case "signature_rejected":
        return `[${time}] REJECTED: Invalid Ed25519 signature from ${log.detail.deviceId}`;
      case "device_forbidden":
        return `[${time}] FORBIDDEN: Device ${log.detail.deviceId} rejected (${log.detail.reason})`;
      case "batch_failed_review":
        return `[${time}] FLAGGED: Batch ${log.detail.batchId} routed to manual review (${log.detail.reason})`;
      case "oversized_memo_rejected":
        return `[${time}] MEMO REJECTED: Batch ${log.detail.batchId} exceeded 120-byte limit`;
      default:
        return `[${time}] ${log.actor.toUpperCase()}: ${log.action.replace(/_/g, " ")} ${
          log.detail.batchId ? `(Batch: ${log.detail.batchId})` : ""
        }`;
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 shadow-lg transition-colors duration-200">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wider">
            Live System Audit Log
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Immutable SQLite audit entries in plain English
          </p>
        </div>
        <span className="text-xs text-muted font-mono">{logs.length} latest</span>
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label="System audit log feed"
        className="bg-surface-alt rounded-lg p-3 max-h-56 overflow-y-auto font-mono text-xs text-text divide-y divide-border-subtle border border-border focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        {logs.length === 0 ? (
          <div className="py-6 text-center text-muted italic">
            No audit log entries recorded yet.
          </div>
        ) : (
          logs.map((log) => {
            const isError =
              log.action.includes("conflict") ||
              log.action.includes("rejected") ||
              log.action.includes("forbidden") ||
              log.action.includes("failed");

            return (
              <div
                key={log.id}
                className={`py-1.5 px-1 flex items-start gap-2 ${
                  isError ? "text-rose-600 dark:text-rose-300" : "text-text"
                }`}
              >
                <span className="text-muted text-[11px] select-none shrink-0">#{log.id}</span>
                <span className="break-all">{formatLogPlainLanguage(log)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
