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

      <div className="p-5">
        <div
          tabIndex={0}
          role="region"
          aria-label="Recent settlement batches"
          className="overflow-x-auto w-full max-w-full max-h-[380px] overflow-y-auto rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <table className="w-full text-left border-collapse text-[1.125rem]">
            <thead className="sticky top-0 bg-surface-alt border-b border-border z-10">
              <tr>
                <th scope="col" className="py-3.5 px-4 text-[1rem] font-semibold text-muted uppercase tracking-wider">
                  Batch ULID
                </th>
                <th scope="col" className="py-3.5 px-4 text-[1rem] font-semibold text-muted uppercase tracking-wider">
                  Payee
                </th>
                <th scope="col" className="py-3.5 px-4 text-[1rem] font-semibold text-muted uppercase tracking-wider text-right">
                  Events
                </th>
                <th scope="col" className="py-3.5 px-4 text-[1rem] font-semibold text-muted uppercase tracking-wider text-right">
                  Amount (SOL)
                </th>
                <th scope="col" className="py-3.5 px-4 text-[1rem] font-semibold text-muted uppercase tracking-wider">
                  State
                </th>
                <th scope="col" className="py-3.5 px-4 text-[1rem] font-semibold text-muted uppercase tracking-wider">
                  Explorer Verification
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle bg-surface">
              {batches.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted">
                    <div className="text-xl font-medium text-text">No payments yet.</div>
                    <div className="text-[1.125rem] text-muted mt-1">
                      Start the device simulator to see events arrive.
                    </div>
                  </td>
                </tr>
              ) : (
                batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-surface-hover transition-colors">
                    <td className="py-3.5 px-4 font-mono text-text whitespace-nowrap font-medium text-[1.125rem]">
                      {batch.id}
                    </td>
                    <td className="py-3.5 px-4 text-text whitespace-nowrap">
                      <span className="font-medium text-[1.125rem]">{batch.payeeLabel}</span>
                      {batch.payeeAddress && (
                        <span className="block text-xs font-mono text-muted truncate max-w-[160px]" title={batch.payeeAddress}>
                          {batch.payeeAddress.slice(0, 4)}...{batch.payeeAddress.slice(-4)}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-text text-[1.125rem]">
                      {batch.eventCount}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-text font-semibold text-[1.125rem]">
                      {batch.totalSol}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-[1.125rem]">
                      <StatusBadge state={batch.state} />
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[1.125rem]">
                      {batch.signature ? (
                        <a
                          href={batch.explorerUrl || `https://explorer.solana.com/tx/${batch.signature}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-info-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-text rounded p-1 font-mono text-[1rem]"
                        >
                          <span>{batch.signature.slice(0, 6)}...{batch.signature.slice(-4)}</span>
                          <span aria-hidden="true">↗</span>
                        </a>
                      ) : (
                        <span className="text-muted italic text-[1rem]">Pending signature</span>
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
