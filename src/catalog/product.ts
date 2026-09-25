import { basketBase, cardInfo } from "../wb/basket.js";
import type { WbClient } from "../wb/client.js";
import { productUrl, resolveNm, rub, SITE } from "../wb/format.js";
import { fetchCard, priceInfo } from "./common.js";
import { getReviews } from "./reviews.js";

/** Поля card.json иногда приходят JSON-строкой */
function parseJsonField(v: unknown): any {
  if (typeof v !== "string") return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** Характеристики: grouped_options — по группам, options — плоским списком */
function characteristics(info: any): Record<string, unknown> {
  const grouped = parseJsonField(info?.grouped_options);
  const plain = (options: any[] = []) => Object.fromEntries(options.map((o) => [o.name, o.value]));
  if (grouped) return Object.fromEntries(grouped.map((g: any) => [g.group_name, plain(g.options)]));
  return plain(parseJsonField(info?.options) ?? []);
}

/** Всё о товаре: цены и остатки по размерам, продавец, характеристики, описание, фото, отзывы */
export async function getProduct(wb: WbClient, product: string, { reviews = 20 }: { reviews?: number } = {}) {
  const nm = resolveNm(product);
  const p = await fetchCard(wb, nm);
  const base = await basketBase(wb, nm).catch(() => null);
  const info = base ? await cardInfo(wb, base).catch(() => null) : null;
  const questions = await wb.fetch(`https://questions.wildberries.ru/api/v1/questions?imtId=${p.root}&onlyCount=true`).catch(() => null);
  const photoCount: number = info?.media?.photo_count ?? p.pics ?? 0;

  const result = {
    nm,
    name: p.name as string,
    brand: (p.brand as string) || null,
    url: productUrl(nm),
    category: [info?.subj_root_name, info?.subj_name].filter(Boolean) as string[],
    ...priceInfo(p),
    sizes: (p.sizes ?? []).map((s: any) => ({
      name: s.name || (s.origName && s.origName !== "0" ? s.origName : null),
      price: rub(s.price?.product),
      in_stock: (s.stocks ?? []).reduce((n: number, st: any) => n + (st.qty ?? 0), 0),
    })),
    rating: (p.reviewRating ?? p.rating ?? null) as number | null,
    reviews_count: (p.feedbacks ?? null) as number | null,
    questions: (questions?.count ?? null) as number | null,
    seller: {
      name: (p.supplier as string) || null,
      id: p.supplierId ?? null,
      rating: p.supplierRating ?? null,
      url: p.supplierId ? `${SITE}/seller/${p.supplierId}` : null,
    },
    vendor_code: info?.vendor_code ?? null,
    colors: info?.nm_colors_names ?? (p.colors ?? []).map((c: any) => c.name).join(", "),
    other_colors_nm: ((info?.colors ?? []) as unknown[]).map(String).filter((c) => c !== nm),
    characteristics: characteristics(info),
    contents: info?.contents ?? null, // комплектация
    description: info?.description ?? null,
    images: base ? Array.from({ length: photoCount }, (_, i) => `${base}/images/big/${i + 1}.webp`) : [],
  };
  if (reviews <= 0) return result;

  const r = await getReviews(wb, nm, { perPage: reviews }).catch((e: Error) => ({ error: e.message }));
  return {
    ...result,
    reviews:
      "error" in r
        ? { error: r.error }
        : { total: r.total, with_text: r.with_text, rating: r.rating, scores: r.scores, shown: r.reviews.length, items: r.reviews },
  };
}
