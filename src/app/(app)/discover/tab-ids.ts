export type DiscoverTabId = "series" | "you" | "both";

export const DISCOVER_TABS: { id: DiscoverTabId; label: string }[] = [
  { id: "series", label: "Series" },
  { id: "you", label: "For you" },
  { id: "both", label: "For both of you" },
];

export const tabId = (id: DiscoverTabId) => `discover-tab-${id}`;
export const panelId = (id: DiscoverTabId) => `discover-panel-${id}`;

export function parseTab(v: string | string[] | undefined): DiscoverTabId {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "you" || s === "both" ? s : "series";
}
