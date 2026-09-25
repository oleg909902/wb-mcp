// CDN с описанием и фото товара: basket-XX.wbbasket.ru, номер хоста зависит от vol (артикул / 100 000)
import type { WbClient } from "./client.js";

const hostByVol = new Map<number, string>();
const MAX_BASKETS = 50;

/** Адрес папки товара на CDN: https://basket-12.wbbasket.ru/vol1234/part123456/123456789 */
export async function basketBase(wb: WbClient, nm: string): Promise<string> {
  const n = Number(nm);
  const vol = Math.floor(n / 1e5);
  const path = `/vol${vol}/part${Math.floor(n / 1e3)}/${n}`;
  if (!hostByVol.has(vol)) {
    const candidates = Array.from({ length: MAX_BASKETS }, (_, i) => `https://basket-${String(i + 1).padStart(2, "0")}.wbbasket.ru${path}/info/ru/card.json`);
    const ok = await wb.firstOk(candidates);
    if (!ok) throw new Error("WB: не найден CDN-хост с описанием товара");
    hostByVol.set(vol, ok.slice(0, ok.indexOf("/vol")));
  }
  return hostByVol.get(vol) + path;
}

/** Описание товара с CDN (card.json): характеристики, описание, комплектация, число фото */
export const cardInfo = (wb: WbClient, base: string) => wb.fetch(`${base}/info/ru/card.json`);
