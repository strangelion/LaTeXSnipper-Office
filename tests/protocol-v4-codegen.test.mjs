import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Protocol v4 message inventory is identical in TypeScript, Rust and C#", async () => {
  const schema = JSON.parse(await read("contracts/protocol-v4.json"));
  const [typescript, rust, csharp] = await Promise.all([
    read("src/generated/protocol-v4.ts"),
    read("src-tauri/src/generated/protocol_v4.rs"),
    read("apps/native-office/LaTeXSnipper.Shared/Generated/ProtocolV4.g.cs"),
  ]);

  assert.equal(schema.protocolVersion, 4);
  assert.equal(
    new Set(schema.messages.map(({ wireType }) => wireType)).size,
    9,
  );

  for (const message of schema.messages) {
    assert.match(typescript, new RegExp(`type: "${message.wireType}"`));
    assert.match(rust, new RegExp(`rename = "${message.wireType}"`));
    assert.match(
      csharp,
      new RegExp(
        `JsonDerivedType\\(typeof\\(${message.name}V4\\), "${message.wireType}"\\)`,
      ),
    );
  }
});

test("Protocol v4 uses one object lifecycle instead of per-artifact commands", async () => {
  const schema = JSON.parse(await read("contracts/protocol-v4.json"));
  const wireTypes = schema.messages.map(({ wireType }) => wireType);

  assert.deepEqual(wireTypes.slice(0, 4), [
    "INSERT_OBJECT",
    "GET_OBJECT",
    "UPDATE_OBJECT",
    "DELETE_OBJECT",
  ]);
  assert.equal(
    wireTypes.some((type) => /FORMULA|DRAWING|IMAGE/.test(type)),
    false,
  );
});

test("Protocol v4 requests carry correlation and concurrency fields", async () => {
  const schema = JSON.parse(await read("contracts/protocol-v4.json"));
  assert.deepEqual(
    schema.baseFields.map(({ name }) => name),
    ["requestId", "sessionId", "protocolVersion"],
  );

  for (const name of ["UpdateObject", "DeleteObject"]) {
    const message = schema.messages.find(
      (candidate) => candidate.name === name,
    );
    assert.ok(message, `${name} must be declared`);
    assert.ok(
      message.fields.some(
        ({ name: fieldName, type }) =>
          fieldName === "expectedRevision" && type === "u64",
      ),
      `${name} must reject stale revisions`,
    );
  }

  assert.ok(
    schema.messages.some(({ wireType }) => wireType === "CANCEL_REQUEST"),
  );
  assert.ok(
    schema.messages.some(({ wireType }) => wireType === "OBJECT_PROGRESS"),
  );
  assert.ok(
    schema.messages.some(({ wireType }) => wireType === "OBJECT_DIAGNOSTIC"),
  );
});
