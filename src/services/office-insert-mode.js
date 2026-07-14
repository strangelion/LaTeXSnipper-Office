export const FORMULA_INSERT_MODES = Object.freeze({
  INLINE: "inline",
  DISPLAY: "display",
  NUMBERED: "numbered",
});

export function normalizeOfficeInsertMode(value) {
  switch (value) {
    case "numbered":
    case "displayNumbered":
      return FORMULA_INSERT_MODES.NUMBERED;
    case "display":
    case "block":
      return FORMULA_INSERT_MODES.DISPLAY;
    default:
      return FORMULA_INSERT_MODES.INLINE;
  }
}

export function officeInsertModeIsDisplay(value) {
  return normalizeOfficeInsertMode(value) !== FORMULA_INSERT_MODES.INLINE;
}
