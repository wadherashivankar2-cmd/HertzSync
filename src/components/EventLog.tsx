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
  function formatAuditTimeUtc(at: number | string): string {
    try {
      const d = new Date(at);
      if (isNaN(d.getTime())) return "00:00:00 UTC";
      return d.toISOString().slice(11, 19) + " UTC";
    } catch {
      return "00:00:00 UTC";
    }
  }

  function formatLogPlainLanguage(log: AuditLogItem): string {
    const time = formatAuditTimeUtc(log.at);
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
    <div className="bg-surface border border-border rounded-xl shadow-lg w-full min-w-0 flex flex-col transition-colors duration-200 box-border overflow-hidden h-full">
      <div className="px-5 py-3.5 bg-[var(--section-header-bg)] border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--blue-accent)]" aria-hidden="true" />
            Live System Audit Log
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Immutable SQLite audit entries in plain English (UTC)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-surface border border-border text-muted font-semibold tracking-wider">
            UTC
          </span>
          <span className="text-xs text-muted font-mono">{logs.length} latest</span>
        </div>
      </div>

      <div className="p-5">
        <div
          tabIndex={0}
          role="region"
          aria-label="System audit log feed"
          className="bg-surface-alt rounded-lg p-3.5 w-full max-w-full max-h-[340px] overflow-y-auto font-mono text-[1.125rem] text-text divide-y divide-border-subtle border border-border focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          {logs.length === 0 ? (
            <div className="py-8 text-center text-muted italic text-[1.125rem]">
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
                  className={`py-2 px-1.5 flex items-start gap-2.5 ${
                    isError ? "text-rose-600 dark:text-rose-300" : "text-text"
                  }`}
                >
                  <span className="text-muted text-xs select-none shrink-0 mt-0.5">#{log.id}</span>
                  <span className="break-all leading-relaxed text-[1.125rem]">{formatLogPlainLanguage(log)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
