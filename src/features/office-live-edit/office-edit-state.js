/**
 * Office Live Edit State Machine
 *
 * Manages the UI state for real-time formula editing.
 * States: loading -> ready -> editing -> rendering -> preview-ready
 *         preparing -> committing -> committed | conflict | failed
 */

export const EditState = {
  LOADING: "loading",
  READY: "ready",
  EDITING: "editing",
  RENDERING: "rendering",
  PREVIEW_READY: "preview-ready",
  PREPARING: "preparing",
  COMMITTING: "committing",
  COMMITTED: "committed",
  CONFLICT: "conflict",
  FAILED: "failed",
};

const VALID_TRANSITIONS = {
  [EditState.LOADING]: [EditState.READY, EditState.FAILED],
  [EditState.READY]: [EditState.EDITING, EditState.CONFLICT],
  [EditState.EDITING]: [
    EditState.RENDERING,
    EditState.PREPARING,
    EditState.CONFLICT,
  ],
  [EditState.RENDERING]: [
    EditState.PREVIEW_READY,
    EditState.EDITING,
    EditState.FAILED,
  ],
  [EditState.PREVIEW_READY]: [
    EditState.EDITING,
    EditState.PREPARING,
    EditState.CONFLICT,
  ],
  [EditState.PREPARING]: [EditState.COMMITTING, EditState.FAILED],
  [EditState.COMMITTING]: [
    EditState.COMMITTED,
    EditState.FAILED,
    EditState.CONFLICT,
  ],
  [EditState.COMMITTED]: [],
  [EditState.CONFLICT]: [EditState.LOADING, EditState.READY],
  [EditState.FAILED]: [EditState.READY, EditState.EDITING],
};

export class OfficeEditStateMachine {
  constructor(onTransition) {
    this.state = EditState.LOADING;
    this.onTransition = onTransition || (() => {});
    this.history = [];
  }

  transition(newState, context = {}) {
    const allowed = VALID_TRANSITIONS[this.state] || [];
    if (!allowed.includes(newState)) {
      console.warn(
        `[EditState] Invalid transition: ${this.state} -> ${newState}`,
      );
      return false;
    }
    const prev = this.state;
    this.state = newState;
    this.history.push({ from: prev, to: newState, context, time: Date.now() });
    this.onTransition(newState, prev, context);
    return true;
  }

  canTransition(newState) {
    const allowed = VALID_TRANSITIONS[this.state] || [];
    return allowed.includes(newState);
  }

  isTerminal() {
    return this.state === EditState.COMMITTED;
  }

  isActive() {
    return (
      this.state !== EditState.LOADING &&
      this.state !== EditState.COMMITTED &&
      this.state !== EditState.FAILED
    );
  }
}
