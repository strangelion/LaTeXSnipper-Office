import { vi } from "vitest";
Object.defineProperty(Element.prototype, "getBoundingClientRect", {
  value: () => ({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    top: 0,
    right: 100,
    bottom: 20,
    left: 0,
    toJSON() {},
  }),
});
Object.defineProperty(globalThis, "innerHeight", {
  value: 800,
  configurable: true,
});
Object.defineProperty(globalThis, "chrome", {
  value: {
    i18n: { getMessage: (key: string) => key },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
    runtime: { getManifest: () => ({ version: "1.3.0" }) },
  },
  configurable: true,
});
