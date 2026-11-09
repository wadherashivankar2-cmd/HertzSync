"use client";

import React from "react";
import { StatusBadge } from "./StatusBadge";

export interface BatchItem {
  id: string;
  payeeId: string;
  payeeLabel: string;
  payeeAddress: string;
  totalLamports: number;
  totalSol: string;
  eventCount: number;
  eventsHash: string;
  state: string;
  signature: string | null;
  explorerUrl: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  independentCheck?: boolean;
  singleEndpointFallback?: boolean;
}

function BatchCrossCheckPill({
  independentCheck,
  singleEndpointFallback,
}: {
  independentCheck?: boolean;
  singleEndpointFallback?: boolean;
}) {
  if (independentCheck) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-success-border bg-surface text-success-text whitespace-nowrap shrink-0"
        aria-label="Verified · 2 endpoints"
      >
        <svg
          aria-hidden="true"
          className="w-3 h-3 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span>Verified · 2 endpoints</span>
      </span>
    );
  }

  if (singleEndpointFallback) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-warning-border bg-surface text-warning-text whitespace-nowrap shrink-0"
        aria-label="Single endpoint"
      >
        <span>Single endpoint</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-dashed border-border bg-surface text-muted whitespace-nowrap shrink-0"
      title="Settled before per-batch check recording. Not necessarily verified or unverified."
      aria-label="Legacy · not recorded"
    >
      <span>Legacy · not recorded</span>
    </span>
  );
}

interface BatchTableProps {
  batches: BatchItem[];
  isLoading?: boolean;
}

export function BatchTable({ batches, isLoading = false }: BatchTableProps) {
  return (
    <div className="bg-surface border border-border rounded-xl shadow-lg w-full min-w-0 flex flex-col transition-colors duration-200 box-border overflow-hidden h-full">
      <div className="px-5 py-3.5 bg-[var(--section-header-bg)] border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--blue-accent)]" aria-hidden="true" />
            Settlement Batches
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Aggregated micropayments settled on Solana DevNet
          </p>
        </div>
        <span className="text-xs text-muted font-mono">
          Showing {batches.length} latest
        </span>
      </div>

      <div className="p-3 sm:p-3.5">
        <div
          tabIndex={0}
          role="region"
          aria-label="Recent settlement batches"
          className="overflow-x-auto w-full max-w-full max-h-[380px] overflow-y-auto rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-surface-alt border-b border-border z-10">
              <tr>
                <th scope="col" className="py-2.5 px-1.5 text-xs font-semibold text-muted uppercase tracking-wider leading-tight">
                  Batch<br />ULID
                </th>
                <th scope="col" className="py-2.5 px-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
                  Payee
                </th>
                <th scope="col" className="py-2.5 px-1.5 text-xs font-semibold text-muted uppercase tracking-wider text-right">
                  Events
                </th>
                <th scope="col" className="py-2.5 px-1.5 text-xs font-semibold text-muted uppercase tracking-wider text-right leading-tight">
                  Amount<br />(SOL)
                </th>
                <th scope="col" className="py-2.5 px-1.5 text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap">
                  State
                </th>
                <th scope="col" className="py-2.5 px-1.5 text-xs font-semibold text-muted uppercase tracking-wider leading-tight">
                  Explorer<br />Verification
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle bg-surface">
              {batches.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted">
                    <div className="text-xl font-medium text-text">No payments yet.</div>
                    <div className="text-sm text-muted mt-1">
                      Start the device simulator to see events arrive.
                    </div>
                  </td>
                </tr>
              ) : (
                batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-surface-hover transition-colors">
                    <td className="py-2.5 px-1.5 font-mono text-text whitespace-nowrap font-medium text-xs">
                      <span title={batch.id}>{batch.id.slice(0, 4)}...{batch.id.slice(-4)}</span>
                    </td>
                    <td className="py-2.5 px-1.5 text-text">
                      <span className="font-medium text-xs leading-snug block break-words max-w-[72px]">{batch.payeeLabel}</span>
                      {batch.payeeAddress && (
                        <span className="block text-[11px] font-mono text-muted truncate max-w-[72px]" title={batch.payeeAddress}>
                          {batch.payeeAddress.slice(0, 4)}...{batch.payeeAddress.slice(-4)}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-1.5 text-right font-mono text-text text-xs whitespace-nowrap">
                      {batch.eventCount}
                    </td>
                    <td className="py-2.5 px-1.5 text-right font-mono text-text font-semibold text-xs whitespace-nowrap">
                      {batch.totalSol}
                    </td>
                    <td className="py-2.5 px-1.5 whitespace-nowrap text-xs">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge state={batch.state} className="whitespace-nowrap shrink-0" />
                        <BatchCrossCheckPill
                          independentCheck={batch.independentCheck}
                          singleEndpointFallback={batch.singleEndpointFallback}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-1.5 whitespace-nowrap font-mono text-xs">
                      {batch.signature ? (
                        <a
                          href={batch.explorerUrl || `https://explorer.solana.com/tx/${batch.signature}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={batch.signature}
                          className="inline-flex items-center gap-1 text-info-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-text rounded p-0.5 font-mono text-xs whitespace-nowrap"
                        >
                          <span>{batch.signature.slice(0, 4)}...{batch.signature.slice(-4)}</span>
                          <span aria-hidden="true">↗</span>
                        </a>
                      ) : (
                        <span className="text-muted italic text-xs">Pending signature</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
