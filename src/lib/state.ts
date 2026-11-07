/**
 * State machine definitions for Events and Batches.
 * Section 4.1 & 4.2 of BLUEPRINT.md
 */

export type EventState = "queued" | "batched" | "paid" | "flagged";

export type BatchState =
  | "built"
  | "submitted"
  | "retrying"
  | "confirmed"
  | "expired_rebuilt"
  | "failed_review";

const LEGAL_EVENT_TRANSITIONS: Record<EventState, readonly EventState[]> = {
  queued: ["batched", "flagged"],
  batched: ["paid", "flagged"],
  paid: [], // terminal state
  flagged: [], // terminal state
};

const LEGAL_BATCH_TRANSITIONS: Record<BatchState, readonly BatchState[]> = {
  built: ["submitted"],
  submitted: ["confirmed", "retrying", "failed_review"],
  retrying: ["submitted", "expired_rebuilt", "failed_review"],
  expired_rebuilt: ["submitted"],
  confirmed: [], // terminal state
  failed_review: [], // terminal state
};

export function canTransitionEvent(current: EventState, next: EventState): boolean {
  return LEGAL_EVENT_TRANSITIONS[current].includes(next);
}

export function transitionEvent(current: EventState, next: EventState): EventState {
  if (!canTransitionEvent(current, next)) {
    throw new Error(`Illegal event state transition: cannot move from '${current}' to '${next}'`);
  }
  return next;
}

export function canTransitionBatch(current: BatchState, next: BatchState): boolean {
  return LEGAL_BATCH_TRANSITIONS[current].includes(next);
}

export function transitionBatch(current: BatchState, next: BatchState): BatchState {
  if (!canTransitionBatch(current, next)) {
    throw new Error(`Illegal batch state transition: cannot move from '${current}' to '${next}'`);
  }
  return next;
}

