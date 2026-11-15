import { it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFileSelection } from "@/lib/use-file-selection";
import type { SharedFile } from "@/lib/types";

it("adds forward and reverse inclusive ranges in gesture order and preserves prior selection", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ uniqueID: `${i}`, fileName: `${i}.txt` }) as SharedFile);
  const { result } = renderHook(useFileSelection);
  const click = (i: number, shift = false, scope = "page-one") => act(() => result.current.toggleRange(items[i], items, scope, shift));
  const ids = () => result.current.selectedFiles.map(f => f.uniqueID);
  click(0); click(3, true);
  expect(ids()).toEqual(["0", "1", "2", "3"]);
  act(() => result.current.clear());
  click(5); click(2, true);
  expect(ids()).toEqual(["5", "4", "3", "2"]);
  click(0);
  click(3, true);
  expect(ids()).toEqual(["5", "4", "3", "2", "0", "1"]);
  click(4); click(4);
  expect(ids()).toEqual(["5", "3", "2", "0", "1", "4"]);
});

it("never extends an anchor across a changed page, sort, or filter", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ uniqueID: `${i}` }) as SharedFile);
  const { result } = renderHook(useFileSelection);
  act(() => result.current.toggleRange(items[0], items, "page=1", false));
  act(() => result.current.toggleRange(items[5], items, "page=2", true));
  expect(result.current.selectedFiles.map(f => f.uniqueID)).toEqual(["0", "5"]);
  act(() => result.current.toggleRange(items[2], items, "page=2&q=test", true));
  expect(result.current.selectedFiles.map(f => f.uniqueID)).toEqual(["0", "5", "2"]);
});
