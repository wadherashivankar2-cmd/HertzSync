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
}

interface BatchTableProps {
  batches: BatchItem[];
  isLoading?: boolean;
}

export function BatchTable({ batches, isLoading = false }: BatchTableProps) {
  return (
    <div className="bg-surface border border-slate-800 rounded-xl p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-text uppercase tracking-wider">
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

      <div
        tabIndex={0}
        role="region"
        aria-label="Recent settlement batches"
        className="overflow-x-auto max-h-[420px] rounded-lg border border-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
      >
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 z-10">
            <tr>
              <th scope="col" className="py-3 px-3.5 font-semibold text-muted uppercase tracking-wider">
                Batch ULID
              </th>
              <th scope="col" className="py-3 px-3.5 font-semibold text-muted uppercase tracking-wider">
                Payee
              </th>
              <th scope="col" className="py-3 px-3.5 font-semibold text-muted uppercase tracking-wider text-right">
                Events
              </th>
              <th scope="col" className="py-3 px-3.5 font-semibold text-muted uppercase tracking-wider text-right">
                Amount (SOL)
              </th>
              <th scope="col" className="py-3 px-3.5 font-semibold text-muted uppercase tracking-wider">
                State
              </th>
              <th scope="col" className="py-3 px-3.5 font-semibold text-muted uppercase tracking-wider">
                Explorer Verification
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 bg-surface">
            {batches.length === 0 && !isLoading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted">
                  <div className="text-sm font-medium text-slate-300">No payments yet.</div>
                  <div className="text-xs text-muted mt-1">
                    Start the device simulator to see events arrive.
                  </div>
                </td>
              </tr>
            ) : (
              batches.map((batch) => (
                <tr key={batch.id} className="hover:bg-slate-850/50 transition-colors">
                  <td className="py-3 px-3.5 font-mono text-text whitespace-nowrap font-medium">
                    {batch.id}
                  </td>
                  <td className="py-3 px-3.5 text-slate-200 whitespace-nowrap">
                    <span className="font-medium text-text">{batch.payeeLabel}</span>
                    {batch.payeeAddress && (
                      <span className="block text-[11px] font-mono text-muted truncate max-w-[140px]" title={batch.payeeAddress}>
                        {batch.payeeAddress.slice(0, 4)}...{batch.payeeAddress.slice(-4)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3.5 text-right font-mono text-text">
                    {batch.eventCount}
                  </td>
                  <td className="py-3 px-3.5 text-right font-mono font-medium text-text">
                    {batch.totalSol}
                  </td>
                  <td className="py-3 px-3.5 whitespace-nowrap">
                    <StatusBadge state={batch.state} />
                  </td>
                  <td className="py-3 px-3.5 whitespace-nowrap">
                    {batch.explorerUrl ? (
                      <a
                        href={batch.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-info hover:text-sky-300 transition-colors font-mono underline text-xs"
                      >
                        <span>View on DevNet</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <span className="text-muted text-xs italic">Pending Broadcast</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

