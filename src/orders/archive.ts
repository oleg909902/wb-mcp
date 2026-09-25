// Архив заказов: выкупы, возвраты, отказы
import type { WbClient } from "../wb/client.js";
import { productUrl, rub } from "../wb/format.js";

const ARCHIVE_STATUS = {
  Purchased: "выкуплен",
  Refund: "возврат",
  Rejected: "отказ / отменён",
  FailedPayment: "не оплачен",
  ExcludedFromRate: "выкуплен (не учитывается в проценте выкупа)",
} as const;
export type ArchiveStatus = keyof typeof ARCHIVE_STATUS;
export const ARCHIVE_STATUSES = Object.keys(ARCHIVE_STATUS) as [ArchiveStatus, ...ArchiveStatus[]];

const CACHE_MS = 5 * 60_000;
let cache = { at: 0, list: [] as any[] };

const statusName = (code: string) => ARCHIVE_STATUS[code as ArchiveStatus] ?? code;

function parseArchiveItem(a: any) {
  return {
    name: a.name as string,
    brand: (a.brand as string) || null,
    color: (a.color as string) || null,
    size: a.size && a.size !== "0" ? (a.size as string) : null,
    price: (a.price ?? rub(a.rawPrice)) as number | null,
    status: statusName(a.status),
    status_code: a.status as string,
    ordered: (a.orderDate?.slice(0, 10) ?? null) as string | null,
    finished: (a.lastDate?.slice(0, 10) ?? null) as string | null,
    can_return: Boolean(a.refundable),
    return_until: a.refundable ? (a.lastRefundDate?.slice(0, 10) ?? null) : null,
    nm: a.code1S ? String(a.code1S) : null,
    url: a.code1S ? productUrl(a.code1S) : null,
  };
}

/** Архив. WB отдаёт его целиком (до 1000 заказов), поэтому он кешируется на 5 минут, а фильтры и страницы — на нашей стороне. */
export async function archiveOrders(
  wb: WbClient,
  { status, query, page = 1, perPage = 30 }: { status?: ArchiveStatus; query?: string; page?: number; perPage?: number } = {}
) {
  if (Date.now() - cache.at > CACHE_MS) {
    const data = await wb.fetch("/webapi/lk/myorders/archive/get", { method: "POST", body: { limit: 1000, offset: 0 }, auth: true });
    cache = { at: Date.now(), list: data?.value?.archive ?? [] };
  }

  let list = cache.list.map(parseArchiveItem);
  if (status) list = list.filter((a) => a.status_code === status);
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((a) => `${a.name} ${a.brand ?? ""}`.toLowerCase().includes(q));
  }
  list.sort((a, b) => (b.ordered ?? "").localeCompare(a.ordered ?? ""));

  const counts: Record<string, number> = {};
  for (const a of cache.list) counts[statusName(a.status)] = (counts[statusName(a.status)] ?? 0) + 1;
  const start = (page - 1) * perPage;
  return {
    total: list.length,
    all_by_status: counts,
    page,
    has_next_page: start + perPage < list.length,
    items: list.slice(start, start + perPage),
  };
}
