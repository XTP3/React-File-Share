import { expect, it } from "vitest";
import { readSidebarCollapsed, saveSidebarCollapsed } from "@/lib/preferences";

it("defaults to an expanded sidebar and keeps collapse choices per account", () => {
  expect(readSidebarCollapsed("sidebar-one")).toBe(false);
  saveSidebarCollapsed("sidebar-one", true);
  expect(readSidebarCollapsed("sidebar-one")).toBe(true);
  expect(readSidebarCollapsed("sidebar-two")).toBe(false);
  saveSidebarCollapsed("sidebar-one", false);
  expect(readSidebarCollapsed("sidebar-one")).toBe(false);
});
