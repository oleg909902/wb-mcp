import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSearchFilters } from "../catalog/filters.js";
import { getProductImages, IMAGE_SIZE_NAMES } from "../catalog/images.js";
import { getProduct } from "../catalog/product.js";
import { getReviews, REVIEW_SORTS } from "../catalog/reviews.js";
import { SEARCH_SORTS, searchProducts } from "../catalog/search.js";
import type { WbClient } from "../wb/client.js";
import { jsonResult, READ_ONLY, safe } from "./results.js";

const productArg = z.string().min(1).describe("Ссылка на товар WB (wildberries.ru/catalog/<артикул>/detail.aspx) или артикул");
const filtersArg = z
  .record(z.string(), z.union([z.array(z.union([z.number(), z.string()])), z.number(), z.string(), z.boolean()]))
  .optional()
  .describe(
    "Фильтры из get_search_filters: {<key>: [id значений]}. Цена в рублях: {priceU: [от, до]}. " +
      "Срок доставки: {fdlvr: <часов не больше>}. Переключатели: {frating: 1, foriginal: 1}. " +
      "Пример: {fbrand: [806585], priceU: [100, 400], frating: 1}"
  );

export function registerProductTools(server: McpServer, wb: WbClient): void {
  server.registerTool(
    "search_products",
    {
      title: "Поиск товаров на Wildberries",
      description:
        "Ищет товары на WB (до 100 на страницу): артикул, название, бренд, цена, старая цена, скидка, остаток, " +
        "срок доставки в часах, рейтинг, отзывы, продавец. Если выдача слишком широкая или пользователь назвал " +
        "условия (бюджет, бренд, цвет, размер, характеристики, быструю доставку, высокий рейтинг) — сначала вызови " +
        "get_search_filters, выбери подходящие значения и повтори поиск с параметром filters.",
      inputSchema: {
        query: z.string().min(1).describe("Поисковый запрос"),
        sort: z.enum(SEARCH_SORTS).optional().describe("popular (по умолчанию), rating, price — дешевле, price_desc — дороже, new, benefit — выгодные"),
        page: z.number().int().min(1).max(50).optional().describe("Страница, по умолчанию 1"),
        filters: filtersArg,
      },
      annotations: READ_ONLY,
    },
    safe(async (args) => jsonResult(await searchProducts(wb, args)))
  );

  server.registerTool(
    "get_search_filters",
    {
      title: "Фильтры поиска Wildberries",
      description:
        "Доступные фильтры для поискового запроса WB: категория, бренд, цвет, продавец, диапазон цены, срок доставки, " +
        "характеристики товара (например материал, размер, форма) и переключатели (рейтинг от 4,7, оригинал, премиум-продавец). " +
        "Возвращает key и id значений — их передают в search_products.filters. Можно передать уже выбранные filters, " +
        "чтобы увидеть, как сузилась выдача (total) и что ещё можно уточнить.",
      inputSchema: { query: z.string().min(1).describe("Поисковый запрос"), filters: filtersArg },
      annotations: READ_ONLY,
    },
    safe(async (args) => jsonResult(await getSearchFilters(wb, args)))
  );

  server.registerTool(
    "get_product",
    {
      title: "Карточка товара Wildberries",
      description:
        "Вся информация о товаре WB по ссылке или артикулу: цена, скидка, остатки по размерам, срок доставки, бренд, " +
        "продавец и его рейтинг, категория, все характеристики по группам, комплектация, описание, другие цвета, " +
        "ссылки на фото, рейтинг с распределением оценок и последние отзывы. Больше отзывов — get_reviews, фото — get_product_images.",
      inputSchema: {
        product: productArg,
        reviews: z.number().int().min(0).max(30).optional().describe("Сколько отзывов приложить, по умолчанию 20, 0 — без отзывов"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ product, reviews }) => jsonResult(await getProduct(wb, product, { reviews })))
  );

  server.registerTool(
    "get_reviews",
    {
      title: "Отзывы о товаре Wildberries",
      description:
        "Отзывы WB по 30 на страницу: оценка, дата, текст, достоинства/недостатки, вариант товара (цвет/размер), " +
        "соответствие размеру, ответ продавца. Плюс рейтинг и распределение оценок. WB отдаёт только отзывы с текстом.",
      inputSchema: {
        product: productArg,
        sort: z.enum(REVIEW_SORTS).optional().describe("new (по умолчанию), useful, score_desc, score_asc — сначала плохие (искать недостатки)"),
        page: z.number().int().min(1).max(50).optional(),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ product, sort, page }) => jsonResult(await getReviews(wb, product, { sort, page })))
  );

  server.registerTool(
    "get_product_images",
    {
      title: "Фото товара Wildberries",
      description: "Фотографии товара WB как изображения, чтобы их рассмотреть (внешний вид, цвет, упаковка, размерная сетка).",
      inputSchema: {
        product: productArg,
        limit: z.number().int().min(1).max(10).optional().describe("Сколько фото, по умолчанию 4"),
        size: z.enum(IMAGE_SIZE_NAMES).optional().describe("small — ~500 px (по умолчанию, быстро), medium/original — ~900x1200, чтобы читать мелкий текст"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ product, limit, size }) => {
      const r = await getProductImages(wb, product, { limit, size });
      const summary = { nm: r.nm, name: r.name, shown: r.images.length, total: r.total, urls: r.all_urls };
      return {
        content: [
          { type: "text", text: JSON.stringify(summary, null, 1) },
          ...r.images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType })),
        ],
      };
    })
  );
}
