import type { WbClient } from "../wb/client.js";
import { productUrl } from "../wb/format.js";
import { priceInfo } from "./common.js";
import { filterParams, getSearchFilters, searchUrl, type SearchFilters } from "./filters.js";

const SORTS = { popular: "popular", rating: "rate", price: "priceup", price_desc: "pricedown", new: "newly", benefit: "benefit" } as const;
export type SearchSort = keyof typeof SORTS;
export const SEARCH_SORTS = Object.keys(SORTS) as [SearchSort, ...SearchSort[]];

function parseSearchItem(p: any) {
  return {
    nm: String(p.id),
    name: p.name as string,
    brand: (p.brand as string) || null,
    ...priceInfo(p),
    rating: (p.reviewRating ?? p.rating ?? null) as number | null,
    reviews: (p.feedbacks ?? null) as number | null,
    seller: (p.supplier as string) || null,
    seller_rating: (p.supplierRating ?? null) as number | null,
    colors: (p.colors ?? []).map((c: any) => c.name as string),
    url: productUrl(p.id),
  };
}

export type SearchOptions = { query: string; sort?: SearchSort; page?: number; filters?: SearchFilters };

/** Поиск, до 100 товаров на страницу, с подсказками модели, как сузить выдачу */
export async function searchProducts(wb: WbClient, { query, sort = "popular", page = 1, filters }: SearchOptions) {
  const url = await searchUrl(wb, query, { resultset: "catalog", sort: SORTS[sort] ?? "popular", page: String(page), ...filterParams(filters) });
  const data = await wb.fetch(url);
  const products: any[] = data.products ?? data.data?.products ?? [];
  const total: number | null = data.total ?? data.data?.total ?? null;
  const hasFilters = Boolean(filters && Object.keys(filters).length);

  // При сортировке по цене или «разношёрстной» выдаче первыми идут дешёвые аксессуары
  // и товары из соседних категорий — предлагаем сразу сузить категорию
  const hints: string[] = [];
  let suggested: { id: number; name: string; count?: number }[] | undefined;
  const categoryChosen = Boolean(filters && "xsubject" in filters);
  const mixed = new Set(products.slice(0, 30).map((p) => p.subjectId).filter(Boolean)).size > 3;
  const byPrice = sort === "price" || sort === "price_desc";
  if (!categoryChosen && (mixed || byPrice)) {
    const f = await getSearchFilters(wb, { query, filters }).catch(() => null);
    const cats = f?.filters.find((x) => x.key === "xsubject");
    const values = cats && "values" in cats ? cats.values : [];
    if (values.length > 1) {
      suggested = values.slice(0, 8);
      hints.push(
        (byPrice ? "При сортировке по цене первыми идут дешёвые аксессуары и сопутствующие товары. " : "В выдаче товары из разных категорий. ") +
          `Если нужен конкретный тип товара — повтори поиск с filters: {xsubject: [id]} из suggested_categories (например «${values[0].name}» → ${values[0].id}).`
      );
    }
  }
  if (total && total > 500 && !hasFilters) {
    hints.push("Товаров очень много — если пользователь назвал бюджет, бренд или характеристики, примени их через get_search_filters / filters (цена: priceU: [от, до]).");
  }
  if (!products.length) hints.push("Ничего не найдено — попробуй убрать часть фильтров или переформулировать запрос короче.");

  return {
    query,
    filters: filters ?? {},
    page,
    total,
    count: products.length,
    items: products.map(parseSearchItem),
    ...(suggested ? { suggested_categories: suggested } : {}),
    ...(hints.length ? { hints } : {}),
  };
}
