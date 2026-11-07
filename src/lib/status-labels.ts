export type InternalState =
  | "queued"
  | "batched"
  | "paid"
  | "flagged"
  | "retrying"
  | "conflict"
  | "built"
  | "submitted"
  | "confirmed"
  | "expired_rebuilt"
  | "failed_review";

export type StatusColor = "pending" | "accent" | "failed" | "info";

export interface StatusMeta {
  label: string;
  color: StatusColor;
  tooltip: string;
}

export const STATUS_MAP: Record<InternalState, StatusMeta> = {
  queued: {
    label: "Waiting to be paid",
    color: "pending",
    tooltip: "Recorded safely. Will be paid when the network is available.",
  },
  batched: {
    label: "Being paid",
    color: "pending",
    tooltip: "Grouped into a payment that is on its way.",
  },
  paid: {
    label: "Paid on Solana",
    color: "accent",
    tooltip: "Confirmed on the Solana test network.",
  },
  flagged: {
    label: "Needs review",
    color: "failed",
    tooltip: "Could not be paid automatically. A person should check it.",
  },
  retrying: {
    label: "Retrying",
    color: "pending",
    tooltip: "The network did not confirm yet. Trying again safely.",
  },
  conflict: {
    label: "Conflicting record",
    color: "failed",
    tooltip: "A different record with the same ID arrived. The original was kept.",
  },
  built: {
    label: "Being paid",
    color: "pending",
    tooltip: "Grouped into a payment that is on its way.",
  },
  submitted: {
    label: "Submitted to network",
    color: "pending",
    tooltip: "Payment sent to Solana DevNet; awaiting confirmation.",
  },
  confirmed: {
    label: "Paid on Solana",
    color: "accent",
    tooltip: "Confirmed on the Solana test network.",
  },
  expired_rebuilt: {
    label: "Rebuilt after timeout",
    color: "pending",
    tooltip: "Transaction expired before confirmation; rebuilt safely with a fresh blockhash.",
  },
  failed_review: {
    label: "Needs review",
    color: "failed",
    tooltip: "Could not be paid automatically. A person should check it.",
  },
};

export function getStatusMeta(state: string): StatusMeta {
  if (state in STATUS_MAP) {
    return STATUS_MAP[state as InternalState];
  }
  return {
    label: state,
    color: "info",
    tooltip: `Status: ${state}`,
  };
}

