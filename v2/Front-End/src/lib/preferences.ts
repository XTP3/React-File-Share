import {
  categories,
  defaultPreferences,
  type ExplorerPreferences,
} from "./types";
const prefix = "fileshare:v2:";
export function readPreferences(
  user: string,
  collection: string,
): ExplorerPreferences {
  try {
    const stored = JSON.parse(
      localStorage.getItem(prefix + user + ":" + collection) || "null",
    );
    if (!stored || stored.version !== 1) return { ...defaultPreferences };
    const p = stored.value;
    return {
      ...defaultPreferences,
      view: p.view === "grid" ? "grid" : "list",
      sort: ["name", "date", "size", "type"].includes(p.sort) ? p.sort : "date",
      direction: p.direction === "asc" ? "asc" : "desc",
      pageSize: [25, 50, 100].includes(p.pageSize) ? p.pageSize : 25,
      q: typeof p.q === "string" ? p.q.slice(0, 200) : "",
      uncollected: p.uncollected === true,
      categories: Array.isArray(p.categories)
        ? p.categories.filter((c: unknown) => categories.includes(c as never))
        : [],
      ...Object.fromEntries(
        ["minSize", "maxSize", "from", "to"].map((k) => [
          k,
          typeof p[k] === "string" &&
          (k === "minSize" || k === "maxSize"
            ? /^\d+(\.\d+)?$/.test(p[k]) && Number.isFinite(Number(p[k]))
            : /^\d{4}-\d{2}-\d{2}$/.test(p[k]) &&
              Number.isFinite(new Date(p[k]).getTime()))
            ? p[k]
            : "",
        ]),
      ),
    };
  } catch {
    return { ...defaultPreferences };
  }
}
export function savePreferences(
  user: string,
  collection: string,
  value: ExplorerPreferences,
) {
  try {
    localStorage.setItem(
      prefix + user + ":" + collection,
      JSON.stringify({ version: 1, value }),
    );
  } catch {
    /* storage can be disabled */
  }
}
export type Theme = "dark" | "light" | "system";
export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem("fileshare:theme");
    return value === "light" || value === "system" ? value : "dark";
  } catch {
    return "dark";
  }
}
export function applyTheme(value: Theme) {
  document.documentElement.classList.toggle(
    "dark",
    value === "dark" ||
      (value === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches),
  );
  try {
    localStorage.setItem("fileshare:theme", value);
  } catch {
    /* private storage */
  }
}
