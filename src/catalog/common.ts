// Общее для запросов к каталогу WB
import type { WbClient } from "../wb/client.js";
import { rub } from "../wb/format.js";

/** Параметры, которые сайт WB передаёт во все запросы каталога; dest — регион для цен и сроков доставки */
export async function catalogParams(wb: WbClient): Promise<string> {
  return `appType=1&curr=rub&dest=${await wb.dest()}&spp=30&hide_vflags=4294967296&hide_dflags=1048576&lang=ru&locale=ru&ab_testing=false`;
}

/** Товар из API каталога: /__internal/card/cards/v4/detail или результатов поиска */
export async function fetchCard(wb: WbClient, nm: string): Promise<any> {
  const data = await wb.fetch(`/__internal/card/cards/v4/detail?${await catalogParams(wb)}&nm=${nm}`);
  const p = data.products?.[0];
  if (!p) throw new Error(`WB: товар ${nm} не найден`);
  return p;
}

/** Цена, остаток и срок доставки товара из ответа поиска или карточки */
export function priceInfo(p: any) {
  const size = (p.sizes ?? []).find((s: any) => s.price) ?? p.sizes?.[0];
  const price = size?.price;
  return {
    price: rub(price?.product),
    original_price: rub(price?.basic),
    discount: price?.basic && price?.product ? `−${Math.round((1 - price.product / price.basic) * 100)}%` : null,
    in_stock: (p.totalQuantity as number) ?? null,
    // time1 + time2 — часы до доставки на выбранный адрес
    delivery_hours: p.time1 != null || p.time2 != null ? (p.time1 ?? 0) + (p.time2 ?? 0) : null,
  };
}
