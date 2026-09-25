import { basketBase, cardInfo } from "../wb/basket.js";
import type { WbClient } from "../wb/client.js";
import { resolveNm } from "../wb/format.js";

/** Папки размеров на CDN: small ~516x688, medium/original — big (~900x1200, самый крупный, что отдаёт CDN) */
const IMAGE_SIZES = { small: "c516x688", medium: "big", original: "big" } as const;
export type ImageSize = keyof typeof IMAGE_SIZES;
export const IMAGE_SIZE_NAMES = Object.keys(IMAGE_SIZES) as [ImageSize, ...ImageSize[]];

export type ProductImage = { url: string; mimeType: string; data: string };

/** Фото товара как картинки (base64). Публичный CDN — качаем напрямую, без браузера. */
export async function getProductImages(wb: WbClient, product: string, { limit = 4, size = "small" }: { limit?: number; size?: ImageSize } = {}) {
  const nm = resolveNm(product);
  const base = await basketBase(wb, nm);
  const info = await cardInfo(wb, base).catch(() => null);
  const count: number = info?.media?.photo_count ?? limit;
  const dir = IMAGE_SIZES[size] ?? IMAGE_SIZES.small;

  const images: ProductImage[] = [];
  for (let i = 1; i <= Math.min(count, limit); i++) {
    const url = `${base}/images/${dir}/${i}.webp`;
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) continue;
    images.push({ url, mimeType: res.headers.get("content-type")?.split(";")[0] || "image/webp", data: Buffer.from(await res.arrayBuffer()).toString("base64") });
  }
  return {
    nm,
    name: (info?.imt_name ?? null) as string | null,
    total: count,
    all_urls: Array.from({ length: count }, (_, i) => `${base}/images/big/${i + 1}.webp`),
    images,
  };
}
