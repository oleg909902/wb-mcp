// Текущие заказы: что едет и что ждёт в пункте выдачи (только чтение).
// Код получения заказов (localStorage _private_code_*) намеренно НЕ читается и не отдаётся.
import type { WbClient } from "../wb/client.js";
import { daysUntil, fromUnix, productUrl, rub } from "../wb/format.js";
import { trackStatuses } from "./tracking.js";

const ORDERS_URL = "https://wbxoofex.wildberries.ru/api/v2/orders?limit=100&exclude_delivery_types=777%2C778&exclude_b2b=true&offset=0";
const READY_STATUS = /приходите за товаром|готов к получению|можно забрать|ожидает в пункте|прибыл в пункт/i;

export type ActiveOrderItem = Awaited<ReturnType<typeof activeOrders>>["items"][number];

export async function activeOrders(wb: WbClient) {
  const [data, profile] = await Promise.all([wb.fetch(ORDERS_URL, { auth: true }), wb.profile()]);
  const points = new Map(profile.points.map((p) => [p.id, p]));
  const orders: any[] = data?.data ?? [];
  const history = await trackStatuses(
    wb,
    orders.flatMap((o) => (o.rids ?? []).map((r: any) => r.uid))
  );

  const items = orders.flatMap((o) =>
    (o.rids ?? []).map((r: any) => {
      const statuses = history[r.uid] ?? [];
      const last = statuses.at(-1);
      const pointId = String(r.dst_office_id ?? o.dst_office_id);
      const point = points.get(pointId);
      const expected = fromUnix(r.delivery_time);
      const ready = READY_STATUS.test(last?.status ?? "");
      const keepUntil = fromUnix(r.expiry_dt); // до какого момента заказ действует/хранится
      return {
        name: r.name as string,
        brand: (r.brand as string) || null,
        color: (r.color as string) || null,
        size: r.size && r.size !== "0" ? (r.size as string) : null,
        price: rub(r.price ?? r.total_price),
        original_price: rub(r.basic_price),
        nm: String(r.nm_id),
        url: productUrl(r.nm_id),
        ordered: fromUnix(o.order_dt),
        status: last?.status ?? null,
        status_date: last?.date ?? null,
        ready_for_pickup: ready,
        expected_delivery: expected,
        days_until_delivery: ready ? 0 : daysUntil(expected),
        keep_until: keepUntil,
        days_left: daysUntil(keepUntil),
        pickup_point: point ? { address: point.address, work_time: point.work_time, type: point.type } : { id: pointId },
        paid: r.pay_state === 1 ? true : r.pay_state === 0 ? false : null,
        history: statuses.map((s) => `${s.date?.slice(0, 16).replace("T", " ")} — ${s.status}${s.place ? ` (${s.place})` : ""}`),
      };
    })
  );
  return { count: items.length, items };
}
