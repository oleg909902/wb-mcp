// MCP сервер для Wildberries.
// Запуск: node dist/index.js          — HTTP (Streamable HTTP) на :3000/mcp, для ChatGPT
//         node dist/index.js --stdio  — stdio, для Claude Code / локальной отладки
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { createMcpServer } from "./mcp/server.js";
import { serveHttp } from "./transport/http.js";
import { WbClient } from "./wb/client.js";

const wb = new WbClient(config.cdpUrl);
wb.startAntibotRefresh(config.antibotRefreshMin);

if (process.argv.includes("--stdio")) {
  await createMcpServer(wb).connect(new StdioServerTransport());
  console.error("wb-mcp: stdio");
} else {
  await serveHttp(() => createMcpServer(wb), config);
  console.log(`wb-mcp: http://${config.host}:${config.port}/mcp  (CDP: ${config.cdpUrl})`);
}
