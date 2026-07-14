import { describe, expect, it } from "vitest";
import { BRIDGE_BASE_URL } from "../src/bridge/client";
describe("browser bridge boundary", () => { it("uses the ecosystem port only", () => { expect(BRIDGE_BASE_URL).toBe("http://127.0.0.1:19877"); expect(BRIDGE_BASE_URL).not.toContain("19876"); }); });
