# wb-mcp

MCP server for [Wildberries](https://www.wildberries.ru): product search with filters, product details, reviews, photos
and orders (read-only).

Requests to WB run inside a wildberries.ru tab of an already running Chrome (via the Chrome DevTools Protocol),
so they use the browser's session, cookies, proxy and WB's anti-bot token. The auth token and `deviceid` are added
to requests right in the browser and never leave it.

## Tools

| Tool | What it does |
|---|---|
| `search_products(query, sort?, page?, filters?)` | up to 100 products per page: article (nm), name, brand, price, old price, discount, stock, delivery time in hours, rating, reviews, seller; plus `hints` and `suggested_categories` on how to narrow the results |
| `get_search_filters(query, filters?)` | available filters: category, brand, color, seller, price range, delivery time, product characteristics, toggles (rating 4.7+, original, premium seller) |
| `get_product(product, reviews?)` | everything about a product by link or article: prices and stock by size, seller, characteristics by group, package contents, description, other colors, photos, rating distribution and reviews (20 by default) |
| `get_reviews(product, sort?, page?)` | reviews, 30 per page; `sort`: `new`, `useful`, `score_desc`, `score_asc` |
| `get_product_images(product, limit?, size?)` | product photos as images for the model; `size`: `small` (~500 px, default), `medium`/`original` (~900×1200) |
| `orders_summary()` | what is waiting at pickup points (where, opening hours, pick-up deadline, amount to pay) and what is in transit |
| `active_orders()` | current orders with the full status history, pickup point, storage deadline, paid or not |
| `archive_orders(status?, query?, page?)` | order history (up to 1000): purchased, returned, rejected; whether an item can still be returned |

Search `sort`: `popular` (default), `rating`, `price`, `price_desc`, `new`, `benefit`.

Filters (keys and ids come from `get_search_filters`):

```json
{ "fbrand": [806585], "xsubject": [3274], "f169737": [169744], "priceU": [20000, 60000], "fdlvr": 48, "frating": 1 }
```

`priceU` is `[from, to]` in rubles, `fdlvr` is the maximum delivery time in hours, toggles are `1`.

Orders are read-only. The order pickup code is intentionally never read or returned: it can be used to collect parcels.

Tool descriptions and responses are in Russian, like Wildberries itself.

## Requirements

- Node.js 22+
- Chrome/Chromium with a remote debugging port (`--remote-debugging-port=9222`), logged in to Wildberries
- [Proxy Tunnel](https://github.com/oleg909902/proxytunnel) if Chrome runs on a server (see below)

### Why Proxy Tunnel

WB's anti-bot (`__wbaas`) blocks or constantly challenges traffic from datacenter IPs, so a Chrome on a VPS
going out through the VPS's own IP doesn't work reliably. [Proxy Tunnel](https://github.com/oleg909902/proxytunnel)
is an Android app that turns a phone into the server's internet exit: it runs an HTTP proxy on the phone
and opens a reverse SSH tunnel, so `127.0.0.1:18081` appears on the server and everything sent to it
goes out through the phone's mobile network. Chrome on the server is launched with this proxy,
and WB sees an ordinary mobile IP.

```
wb-mcp ──CDP (:9222)──► Chrome on the server ──proxy 127.0.0.1:18081──► reverse SSH tunnel
                                                                              │
                             WB ◄── mobile internet ◄── phone (Proxy Tunnel) ◄┘
```

Setup:

1. Set up the server and the phone as described in the [Proxy Tunnel README](https://github.com/oleg909902/proxytunnel#1-server-setup)
   and check that the tunnel is up: `curl -x http://127.0.0.1:18081 https://ifconfig.me` shows the phone's IP.
2. Launch Chrome on the server with the proxy and a local-only debugging port:

   ```bash
   google-chrome \
     --user-data-dir="$HOME/chrome-profile" \
     --proxy-server=http://127.0.0.1:18081 \
     --remote-debugging-address=127.0.0.1 \
     --remote-debugging-port=9222 \
     https://www.wildberries.ru/
   ```

3. Log in to Wildberries in this Chrome once (for example over VNC/RDP); the session is kept in the profile.
4. Point wb-mcp at the debugging port: run it on the same server with `CDP_URL=http://127.0.0.1:9222`,
   or forward the port to your machine (next section).

If the phone disconnects, Chrome loses internet access and tools fail with network errors until the tunnel is back.
Never expose the debugging port to the internet: it gives full control over the browser and its WB session.

## Running

```bash
npm install
npm run build
npm start            # HTTP: http://127.0.0.1:3000/mcp (Streamable HTTP, for ChatGPT etc.)
npm run stdio        # stdio (for Claude Code, see .mcp.json)
```

Environment variables:

| Variable | Default | |
|---|---|---|
| `CDP_URL` | `http://127.0.0.1:9223` | HTTP address of Chrome's debugging port |
| `HOST` | `127.0.0.1` | HTTP server bind address |
| `PORT` | `3000` | HTTP server port |
| `WB_REFRESH_MIN` | `20` | refresh the anti-bot token every N idle minutes (`0` disables) |

Prices, stock and delivery times are for the region of the main pickup point saved in the WB profile
(Moscow if there is none).

### Chrome on a remote server

If Chrome runs on a server, forward its debugging port to local port 9223 over SSH:

```bash
ssh -M -S /tmp/chrome-cdp-ssh-%r@%h:%p -f -N -L 127.0.0.1:9223:127.0.0.1:9222 user@server
# close the tunnel:
ssh -S /tmp/chrome-cdp-ssh-%r@%h:%p -O exit user@server
```

### Docker

```bash
docker build -t wb-mcp .
docker run --rm -p 3000:3000 -e HOST=0.0.0.0 -e CDP_URL=http://<chrome-host>:9222 wb-mcp
```

## Project layout

```
src/
  index.ts              entry point: stdio or HTTP
  config.ts             environment variables
  cdp/                  minimal Chrome DevTools Protocol client
    connection.ts         WebSocket, commands and events
    browser.ts            tabs: list, open/close, evaluate JS, wait for a condition
  wb/                   WB access
    client.ts             requests from a wildberries.ru tab, request queue, anti-bot handling, profile (region, pickup points)
    basket.ts             product CDN host (basket-XX.wbbasket.ru) lookup, card.json
    format.ts             prices, links, articles, dates
    serial-queue.ts       one request at a time
  catalog/              search, filters, product details, reviews, photos
  orders/               active orders, status tracking, summary, archive
  mcp/                  MCP tool definitions
  transport/http.ts     Streamable HTTP on node:http
```

How it works:

1. `WbClient` finds a wildberries.ru tab (or opens one) and runs `fetch` inside it against WB's own APIs:
   `/__internal/search/...` for search and filters, `/__internal/card/...` for products, `feedbacks` for reviews,
   `wbxoofex` / `wbx-status-tracker` / `/webapi/lk/...` for orders. `deviceid` and the auth token are taken
   from the tab's `localStorage` inside the browser.
2. Requests run strictly one at a time to trigger the anti-bot less often.
3. If WB answers with the anti-bot (HTTP 498), wildberries.ru is opened in a temporary tab, the browser gets a new
   token on its own, the tab is closed and the request is retried. While the server is idle, the token is refreshed
   the same way every `WB_REFRESH_MIN` minutes.
4. Descriptions and photos come from the public CDN `basket-XX.wbbasket.ru`; the host number depends on the article
   and is found once per volume.
