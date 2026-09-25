// История статусов позиций заказа из трекера WB
import type { WbClient } from "../wb/client.js";
import { fromNano } from "../wb/format.js";

export type StatusEntry = { date: string | null; status: string; place: string | null; final: boolean };

/** { uid позиции: [статусы по времени] } */
export async function trackStatuses(wb: WbClient, uids: string[]): Promise<Record<string, StatusEntry[]>> {
  if (!uids.length) return {};
  const data = await wb
    .fetch("https://wbx-status-tracker.wildberries.ru/api/v5/statuses?shard={shard}&lang=ru", { method: "POST", body: { ids: uids }, auth: true })
    .catch(() => []);
  const byUid: Record<string, StatusEntry[]> = {};
  for (const list of Array.isArray(data) ? data : []) {
    for (const s of list ?? []) {
      (byUid[s.rid] ??= []).push({ date: fromNano(s.date), status: s.status_name, place: s.place_name?.trim() || null, final: s.is_final });
    }
  }
  for (const list of Object.values(byUid)) list.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return byUid;
}
