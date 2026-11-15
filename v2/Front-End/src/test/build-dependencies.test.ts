/// <reference types="node" />
import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

type Merge = ((target: unknown, source: unknown, options?: Record<string, unknown>) => Record<string, unknown>) & {
  all: (sources: unknown[]) => Record<string, unknown>;
};
const require = createRequire(import.meta.url);
const merge = require("deepmerge") as Merge;

it("fixes the upstream prototype-poisoning exploit on both target and source writes", () => {
  const source = readFileSync(require.resolve("deepmerge"), "utf8");
  // Restore precisely the three upstream assignment statements as a control:
  // the exploit must reproduce before checking the installed security patch.
  const unpatched = source.replace(/setEnumerableDataProperty\(destination, key, (.+)\);/g, "destination[key] = $1;");
  const control = { exports: undefined as unknown as Merge };
  runInNewContext(unpatched, { module: control });
  const poison = () => JSON.parse('{"__proto__":{"admin":true}}');
  expect(control.exports(poison(), {}).admin).toBe(true);
  expect(control.exports(Object.create(null), poison()).admin).toBe(true);
  expect(merge(poison(), {}).admin).toBeUndefined();
  expect(merge(Object.create(null), poison()).admin).toBeUndefined();
  expect(({} as { admin?: boolean }).admin).toBeUndefined();
});

it("preserves the resolver's merge API, array cloning, symbols and custom merge options", () => {
  const symbol = Symbol("config");
  const input = { nested: { left: 1 }, list: [1], [symbol]: "first" };
  const output = merge(input, { nested: { right: 2 }, list: [2], [symbol]: "second" });
  expect(output).toEqual({ nested: { left: 1, right: 2 }, list: [1, 2], [symbol]: "second" });
  expect(output.nested).not.toBe(input.nested);
  expect(input.list).toEqual([1]);
  expect(merge.all([{ first: true }, { second: true }])).toEqual({ first: true, second: true });
  expect(merge({ list: [1] }, { list: [2] }, { arrayMerge: (_target: unknown, source: unknown) => source })).toEqual({ list: [2] });
});
