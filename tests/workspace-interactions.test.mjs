import { strict as assert } from "node:assert";
import test from "node:test";
import { bindWorkspaceInteractions } from "../src/features/workspace/interactions.js";

class FakeButton extends EventTarget {
  constructor(command = null) {
    super();
    this.dataset = command ? { command } : {};
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
}

test("command bar and Office workspace clicks invoke production handlers", () => {
  const commandButtons = [
    "new",
    "open",
    "export",
    "undo",
    "redo",
    "palette",
  ].map((command) => new FakeButton(command));
  const office = {
    officeWorkspaceRead: new FakeButton(),
    officeWorkspaceReplace: new FakeButton(),
    officeWorkspaceBatch: new FakeButton(),
  };
  const calls = [];
  bindWorkspaceInteractions({
    root: {
      querySelectorAll: () => commandButtons,
      getElementById: (id) => office[id] || null,
    },
    onCommand: (command) => calls.push(`command:${command}`),
    onOfficeRead: () => calls.push("office:read"),
    onOfficeReplace: () => calls.push("office:replace"),
    onOfficeBatch: () => calls.push("office:batch"),
  });
  for (const button of commandButtons) button.click();
  office.officeWorkspaceRead.click();
  office.officeWorkspaceReplace.click();
  office.officeWorkspaceBatch.click();
  assert.deepEqual(calls, [
    "command:new",
    "command:open",
    "command:export",
    "command:undo",
    "command:redo",
    "command:palette",
    "office:read",
    "office:replace",
    "office:batch",
  ]);
});
