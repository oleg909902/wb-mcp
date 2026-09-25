// Сводка: что ждёт в пунктах выдачи и что едет
import type { WbClient } from "../wb/client.js";
import { daysUntil } from "../wb/format.js";
import { activeOrders } from "./active.js";

type PointSummary = { where: string; work_time: string | null; items: string[]; pick_up_before: string | null };

export async function ordersSummary(wb: WbClient) {
  const { items } = await activeOrders(wb);
  const ready = items.filter((i) => i.ready_for_pickup);
  const transit = items.filter((i) => !i.ready_for_pickup);

  const byPoint = new Map<string, PointSummary>();
  for (const i of ready) {
    const where = ("address" in i.pickup_point ? i.pickup_point.address : null) ?? ("id" in i.pickup_point ? i.pickup_point.id : "?");
    let point = byPoint.get(where);
    if (!point) {
      point = { where, work_time: "work_time" in i.pickup_point ? i.pickup_point.work_time : null, items: [], pick_up_before: null };
      byPoint.set(where, point);
    }
    point.items.push(i.name);
    // Забрать нужно до самого раннего срока хранения в этом пункте
    if (i.keep_until && (!point.pick_up_before || i.keep_until < point.pick_up_before)) point.pick_up_before = i.keep_until;
  }

  return {
    today: new Date().toISOString().slice(0, 10),
    ready_for_pickup: {
      count: ready.length,
      to_pay_on_pickup: ready.filter((i) => i.paid === false).reduce((n, i) => n + (i.price ?? 0), 0),
      points: [...byPoint.values()].map((p) => ({ ...p, days_left: daysUntil(p.pick_up_before) })),
    },
    in_transit: {
      count: transit.length,
      items: transit.map((i) => ({
        name: i.name,
        status: i.status,
        expected: i.expected_delivery,
        days_until_delivery: i.days_until_delivery,
        to: "address" in i.pickup_point ? i.pickup_point.address : null,
      })),
    },
  };
}
