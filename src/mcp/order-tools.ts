// Заказы (личный кабинет). Только чтение; код получения не отдаётся.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { activeOrders } from "../orders/active.js";
import { ARCHIVE_STATUSES, archiveOrders } from "../orders/archive.js";
import { ordersSummary } from "../orders/summary.js";
import type { WbClient } from "../wb/client.js";
import { jsonResult, READ_ONLY, safe } from "./results.js";

export function registerOrderTools(server: McpServer, wb: WbClient): void {
  server.registerTool(
    "orders_summary",
    {
      title: "Сводка по заказам Wildberries",
      description:
        "Коротко о текущих заказах WB: что ждёт в пунктах выдачи (где, часы работы, до какого числа забрать) и что едет (статус, когда ожидать).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => jsonResult(await ordersSummary(wb)))
  );

  server.registerTool(
    "active_orders",
    {
      title: "Текущие заказы Wildberries",
      description:
        "Все текущие заказы WB подробно: товар, цена, статус, полная история движения посылки, ожидаемая дата, " +
        "пункт выдачи с адресом и часами работы, срок хранения, оплачен ли.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => jsonResult(await activeOrders(wb)))
  );

  server.registerTool(
    "archive_orders",
    {
      title: "История заказов Wildberries",
      description:
        "Завершённые заказы WB (до 1000 последних): выкупленные, возвраты, отказы. Можно фильтровать по статусу и искать по названию/бренду. " +
        "Для выкупленных показывает, можно ли ещё вернуть и до какого числа.",
      inputSchema: {
        status: z.enum(ARCHIVE_STATUSES).optional().describe("Purchased — выкуплен, Refund — возврат, Rejected — отказ/отмена, FailedPayment — не оплачен"),
        query: z.string().optional().describe("Поиск по названию или бренду, например 'кроссовки'"),
        page: z.number().int().min(1).max(40).optional().describe("Страница по 30, по умолчанию 1"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ status, query, page }) => jsonResult(await archiveOrders(wb, { status, query, page })))
  );
}
