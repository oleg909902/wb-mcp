import type { WbClient } from "../wb/client.js";
import { resolveNm } from "../wb/format.js";
import { fetchCard } from "./common.js";

export const REVIEW_SORTS = ["new", "useful", "score_desc", "score_asc"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export type Review = ReturnType<typeof parseReview>;

function parseReview(r: any) {
  return {
    date: (r.createdDate?.slice(0, 10) ?? null) as string | null,
    author: (r.wbUserDetails?.name ?? null) as string | null,
    score: (r.productValuation ?? 0) as number,
    text: (r.text as string) || null,
    pros: (r.pros as string) || null,
    cons: (r.cons as string) || null,
    variant: [r.color, r.size && r.size !== "0" ? `размер ${r.size}` : null].filter(Boolean).join(", ") || null,
    matching_size: (r.matchingSize as string) || null,
    useful: (r.votes?.pluses ?? 0) as number,
    not_useful: (r.votes?.minuses ?? 0) as number,
    seller_answer: (r.answer?.text ?? null) as string | null,
    nm: r.nmId ? String(r.nmId) : null,
  };
}

const byDateDesc = (a: Review, b: Review) => (b.date ?? "").localeCompare(a.date ?? "");
const SORT_FNS: Record<ReviewSort, (a: Review, b: Review) => number> = {
  new: byDateDesc,
  useful: (a, b) => b.useful - a.useful,
  score_desc: (a, b) => b.score - a.score || byDateDesc(a, b),
  score_asc: (a, b) => a.score - b.score || byDateDesc(a, b),
};

/** Хост отзывов зависит от товара (imt — id объединённой карточки) */
async function reviewsHost(wb: WbClient, imt: number): Promise<string> {
  const hosts = await wb.fetch(`https://feedback-bt.wildberries.ru/feedback/api/v2/host?imt=${imt}`).catch(() => null);
  return (Array.isArray(hosts) && hosts[0]) || "https://feedback-view-02.wb.ru";
}

/** Отзывы: WB отдаёт все отзывы с текстом разом, сортировка и страницы — на нашей стороне */
export async function getReviews(
  wb: WbClient,
  product: string,
  { sort = "new", page = 1, perPage = 30 }: { sort?: ReviewSort; page?: number; perPage?: number } = {}
) {
  const nm = resolveNm(product);
  const imt = (await fetchCard(wb, nm)).root;
  const data = await wb.fetch(`${await reviewsHost(wb, imt)}/feedbacks/v2/${imt}`);
  const list: Review[] = (data.feedbacks ?? []).map(parseReview).sort(SORT_FNS[sort] ?? SORT_FNS.new);
  const start = (page - 1) * perPage;
  return {
    nm,
    total: (data.feedbackCount ?? null) as number | null,
    with_text: (data.feedbackCountWithText ?? null) as number | null,
    rating: data.valuation ? Number(data.valuation) : null,
    scores: (data.valuationDistribution ?? null) as Record<string, number> | null, // {"5": 215, "4": 7, ...}
    size_matching: data.matchingSizePercentages ?? null,
    note: "WB отдаёт только отзывы с текстом; отзывы собраны по всем вариантам товара (поле variant)",
    sort,
    page,
    has_next_page: start + perPage < list.length,
    reviews: list.slice(start, start + perPage),
  };
}
