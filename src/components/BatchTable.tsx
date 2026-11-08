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
    <div className="bg-surface border border-border rounded-xl p-4 shadow-lg h-full w-full min-w-0 flex flex-col justify-between transition-colors duration-200 box-border">
      <div className="flex items-center justify-between mb-3">
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
        className="overflow-x-auto w-full max-w-full h-[180px] max-h-[180px] overflow-y-auto rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 bg-surface-alt border-b border-border z-10">
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
          <tbody className="divide-y divide-border-subtle bg-surface">
            {batches.length === 0 && !isLoading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted">
                  <div className="text-sm font-medium text-text">No payments yet.</div>
                  <div className="text-xs text-muted mt-1">
                    Start the device simulator to see events arrive.
                  </div>
                </td>
              </tr>
            ) : (
              batches.map((batch) => (
                <tr key={batch.id} className="hover:bg-surface-hover transition-colors">
                  <td className="py-3 px-3.5 font-mono text-text whitespace-nowrap font-medium">
                    {batch.id}
                  </td>
                  <td className="py-3 px-3.5 text-text whitespace-nowrap">
                    <span className="font-medium">{batch.payeeLabel}</span>
                    {batch.payeeAddress && (
                      <span className="block text-[11px] font-mono text-muted truncate max-w-[140px]" title={batch.payeeAddress}>
                        {batch.payeeAddress.slice(0, 4)}...{batch.payeeAddress.slice(-4)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3.5 text-right font-mono text-text">
                    {batch.eventCount}
                  </td>
                  <td className="py-3 px-3.5 text-right font-mono text-text font-semibold">
                    {batch.totalSol}
                  </td>
                  <td className="py-3 px-3.5 whitespace-nowrap">
                    <StatusBadge state={batch.state} />
                  </td>
                  <td className="py-3 px-3.5 whitespace-nowrap font-mono text-xs">
                    {batch.signature ? (
                      <a
                        href={batch.explorerUrl || `https://explorer.solana.com/tx/${batch.signature}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-info-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-text rounded p-1 font-mono"
                      >
                        <span>{batch.signature.slice(0, 6)}...{batch.signature.slice(-4)}</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <span className="text-muted italic">Pending signature</span>
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
