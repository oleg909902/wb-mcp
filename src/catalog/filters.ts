import type { WbClient } from "../wb/client.js";
import { rub } from "../wb/format.js";
import { catalogParams } from "./common.js";

/**
 * Фильтры в формате get_search_filters:
 *   { fbrand: [806585, 12], xsubject: [7289], f169737: [169744],  // id значений
 *     priceU: [100, 300],                                         // цена в рублях: [от, до]
 *     fdlvr: 48,                                                  // доставка не дольше, часов
 *     frating: 1, foriginal: 1 }                                  // переключатели
 */
export type SearchFilters = Record<string, number | string | boolean | (number | string)[]>;

export type FilterInfo =
  | { key: "priceU"; name: string; min_rub: number | null; max_rub: number | null }
  | { key: "fdlvr"; name: string; min_hours: number; max_hours: number }
  | { key: string; name: string; type: "toggle" }
  | { key: string; name: string; values: { id: number; name: string; count?: number }[] };

/** Фильтры -> параметры запроса WB */
export function filterParams(filters: SearchFilters = {}): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, raw] of Object.entries(filters)) {
    if (raw == null || raw === "" || (Array.isArray(raw) && !raw.length)) continue;
    const list = Array.isArray(raw) ? raw : [raw];
    if (key === "priceU") {
      const [min, max] = list.map((v) => (v == null ? null : Number(v)));
      params.priceU = `${Math.round((min ?? 0) * 100)};${Math.round((max ?? 10_000_000) * 100)}`; // WB ждёт копейки
    } else if (key === "fdlvr") {
      params.fdlvr = String(list[0]);
    } else {
      params[key] = list.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)).join(";");
    }
  }
  return params;
}

/** Адрес поиска WB: resultset=catalog — товары, resultset=filters — фильтры */
export async function searchUrl(wb: WbClient, query: string, extra: Record<string, string>): Promise<string> {
  const params = new URLSearchParams({ query, suppressSpellcheck: "false", ...extra });
  return `/__internal/search/exactmatch/ru/common/v18/search?${await catalogParams(wb)}&${params}`;
}

const HOW_TO_USE =
  "Передай в search_products параметр filters: {<key>: [id значений]}. Цена: priceU: [от, до] в рублях. " +
  "Срок доставки: fdlvr: <часов не больше>. Переключатели (type=toggle): {<key>: 1}. Можно комбинировать.";

/** Доступные фильтры для запроса (с учётом уже выбранных filters) */
export async function getSearchFilters(wb: WbClient, { query, filters }: { query: string; filters?: SearchFilters }) {
  const data = await wb.fetch(await searchUrl(wb, query, { resultset: "filters", ...filterParams(filters) }));
  const list: any[] = data.data?.filters ?? data.filters ?? [];
  return {
    query,
    total: (data.data?.total as number) ?? null,
    how_to_use: HOW_TO_USE,
    filters: list
      .filter((f) => f.key !== "fdtype")
      .map((f): FilterInfo => {
        if (f.key === "priceU") return { key: "priceU", name: f.name, min_rub: rub(f.minPriceU), max_rub: rub(f.maxPriceU) };
        if (f.key === "fdlvr") return { key: "fdlvr", name: f.name, min_hours: f.minTime, max_hours: f.maxTime };
        if (f.type === "toggle") return { key: f.key, name: f.name, type: "toggle" };
        return {
          key: f.key,
          name: f.name,
          values: (f.items ?? []).map((i: any) => ({ id: i.id, name: i.name, ...(i.count != null ? { count: i.count } : {}) })),
        };
      }),
  };
}
