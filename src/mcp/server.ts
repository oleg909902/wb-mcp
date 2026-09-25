import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WbClient } from "../wb/client.js";
import { registerOrderTools } from "./order-tools.js";
import { registerProductTools } from "./product-tools.js";

const INSTRUCTIONS = [
  "Wildberries: поиск и покупки. Как работать лучше:",
  "- Если пользователь назвал тип товара, бюджет, бренд, характеристики или срок доставки — сначала get_search_filters, потом search_products с filters.",
  "- Читай поле hints в ответах: там подсказки, как сузить выдачу (suggested_categories — готовые id категорий).",
  "- Цены в рублях. delivery_hours — часы до доставки на адрес пользователя.",
  "- Перед рекомендацией товара загляни в get_product (продавец, остатки, отзывы) и при сомнениях — в get_reviews с sort=score_asc.",
  "- Заказы только читаются; ничего не покупай и не отменяй.",
].join("\n");

export function createMcpServer(wb: WbClient): McpServer {
  const server = new McpServer({ name: "wildberries", version: "0.2.0" }, { instructions: INSTRUCTIONS });
  registerProductTools(server, wb);
  registerOrderTools(server, wb);
  return server;
}
