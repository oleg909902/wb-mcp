// Доступ к Wildberries через уже запущенный Chrome.
// Запросы выполняются внутри вкладки wildberries.ru: с её cookie, прокси браузера и
// токеном авторизации, который подставляется прямо в браузере и наружу не передаётся.
import { Browser, sleep, type PageInfo } from "../cdp/browser.js";
import { SITE } from "./format.js";
import { SerialQueue } from "./serial-queue.js";

export type FetchOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  /** Добавить Authorization: Bearer <токен из localStorage>; {shard} в адресе заменяется на шард пользователя */
  auth?: boolean;
};

export type PickupPoint = { id: string; address: string | null; type: string | null; work_time: string | null; main: boolean; dest: number | null };

export type Profile = { loggedIn: boolean; dest: number; points: PickupPoint[] };

/** Регион по умолчанию (Москва), если у пользователя нет пунктов выдачи */
const DEFAULT_DEST = -1257786;
const FETCH_TIMEOUT_MS = 20_000;

export class WbClient {
  private browser: Browser;
  // Запросы идут по одному: так меньше шансов нарваться на антибот
  private queue = new SerialQueue();
  private destCache: number | null = null;

  constructor(cdpUrl: string) {
    this.browser = new Browser(cdpUrl);
  }

  /**
   * fetch из вкладки WB. Если сработал антибот — проходим его во временной вкладке и повторяем запрос один раз.
   * Возвращает распарсенный JSON (или текст, если это не JSON).
   */
  fetch<T = any>(url: string, { method = "GET", body, auth = false }: FetchOptions = {}): Promise<T> {
    return this.queue.run(async () => {
      let res = await this.fetchOnce(url, method, body, auth);
      if (isAntibot(url, res.status)) {
        const passed = await this.passAntibot();
        res = await this.fetchOnce(url, method, body, auth);
        if (isAntibot(url, res.status)) {
          throw new Error(
            passed
              ? "WB снова показал антибот-проверку сразу после её прохождения — попробуй чуть позже"
              : "WB показал антибот-проверку, и браузер не смог пройти её сам. Открой wildberries.ru в серверном браузере и обнови страницу"
          );
        }
      }
      if (res.status === 401) throw new Error("WB: нет входа в аккаунт. Залогинься на wildberries.ru в серверном браузере");
      if (res.status === 599) throw new Error(`WB: нет ответа от ${url.split("?")[0]} (${res.text})`);
      if (res.status >= 400) throw new Error(`WB HTTP ${res.status} ${url.split("?")[0]}`);
      try {
        return JSON.parse(res.text) as T;
      } catch {
        return res.text as T;
      }
    });
  }

  /**
   * Несекретные данные профиля из localStorage: регион (dest) для цен и сроков доставки
   * и сохранённые пункты выдачи. Токен и код получения отсюда НЕ возвращаются.
   */
  profile(): Promise<Profile> {
    return this.queue.run(async () => {
      const profile = await this.browser.evaluate(await this.wbPage(), readProfile);
      return { ...profile, dest: profile.dest ?? DEFAULT_DEST };
    });
  }

  /** Регион для цен и сроков доставки — из основного пункта выдачи (запоминается) */
  async dest(): Promise<number> {
    this.destCache ??= (await this.profile()).dest;
    return this.destCache;
  }

  /** Первый адрес из списка, который отвечает 200 (запросы параллельно, внутри браузера) */
  firstOk(urls: string[]): Promise<string | null> {
    return this.queue.run(async () =>
      this.browser.evaluate(
        await this.wbPage(),
        async (urls) => {
          const statuses = await Promise.all(urls.map((u) => fetch(u).then((r) => r.status).catch(() => 0)));
          return urls[statuses.indexOf(200)] ?? null;
        },
        urls
      )
    );
  }

  /**
   * Пока сервер простаивает, раз в intervalMin минут обновляет токен антибота,
   * чтобы первый запрос после паузы не упирался в проверку.
   */
  startAntibotRefresh(intervalMin: number): void {
    if (intervalMin <= 0) return;
    setInterval(() => {
      if (Date.now() - this.queue.lastActivity < 60_000) return; // не мешаем идущим запросам
      this.queue.run(() => this.passAntibot()).catch(() => {});
    }, intervalMin * 60_000).unref();
  }

  /**
   * Антибот WB (__wbaas) выдаёт токен x_wbaas_token, когда страница загружается по-настоящему
   * и выполняет его скрипт. Фоновый fetch этого не умеет, поэтому открываем wildberries.ru
   * во временной вкладке, ждём, пока браузер получит новый токен, и закрываем. Cookie общие для браузера.
   */
  private async passAntibot(): Promise<boolean> {
    let tab: PageInfo | null = null;
    try {
      tab = await this.browser.openPage(SITE + "/");
      // Ждём запроса create-token; если токен ещё свежий, его может не быть — тогда хватит 10 секунд.
      // (Заголовок страницы не ждём: в фоновой вкладке WB выставляет его с большой задержкой.)
      await this.browser
        .waitFor(tab, () => performance.getEntriesByType("resource").some((e) => /__wbaas\/challenges\/antibot\/api\/v1\/create-token/.test(e.name)), 10_000)
        .catch(() => {});
      await sleep(1_500);
      return true;
    } catch {
      return false;
    } finally {
      if (tab) await this.browser.closePage(tab);
    }
  }

  /**
   * Вкладка WB для запросов. Берём уже открытую (запросы идут без навигации, человеку не мешают);
   * новую открываем, только если вкладок WB нет — иначе они копятся и съедают память сервера.
   */
  private async wbPage(): Promise<PageInfo> {
    const existing = (await this.browser.pages()).find((p) => p.url.startsWith(SITE));
    if (existing) return existing;
    const page = await this.browser.openPage(SITE + "/");
    // Антибот при первом заходе проверяет браузер и перезагружает страницу
    await this.browser.waitFor(page, () => Boolean(document.title) && !/проверк|challenge/i.test(document.title), 30_000).catch(() => {});
    return page;
  }

  private async fetchOnce(url: string, method: string, body: unknown, auth: boolean) {
    const page = await this.wbPage();
    return this.browser.evaluate(page, fetchInPage, url, method, body === undefined ? null : JSON.stringify(body), auth, FETCH_TIMEOUT_MS);
  }
}

/** 498 — антибот; 403 от внутреннего API сайта — тоже он */
const isAntibot = (url: string, status: number) =>
  status === 498 || (status === 403 && (url.startsWith("/") || url.startsWith(SITE)) && /__internal\//.test(url));

// --- Функции ниже выполняются в браузере ---

async function fetchInPage(url: string, method: string, body: string | null, auth: boolean, timeout: number) {
  const headers: Record<string, string> = { Accept: "application/json" };
  // deviceid обязателен для API каталога WB (иначе 403); сайт хранит его в localStorage
  const sid = localStorage.getItem("wbx__sessionID");
  const sameOrigin = url.startsWith("/") || url.startsWith("https://www.wildberries.ru/");
  if (sid && sameOrigin) {
    headers.deviceid = sid;
    headers["x-requested-with"] = "XMLHttpRequest";
  }
  if (body !== null) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = JSON.parse(localStorage.getItem("wbx__tokenData") || "{}").token;
    if (!token) return { status: 401, text: "" };
    headers.Authorization = `Bearer ${token}`;
    // {shard} в адресе — номер шарда пользователя из токена (нужен трекеру статусов)
    if (url.includes("{shard}")) {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      url = url.replace("{shard}", encodeURIComponent(payload.shard_key ?? ""));
    }
  }
  try {
    const r = await fetch(url, {
      method,
      headers,
      body,
      // cookie — только своему сайту и авторизованным API; публичные поддомены без них (иначе CORS)
      credentials: sameOrigin || auth ? "include" : "omit",
      signal: AbortSignal.timeout(timeout),
    });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 599, text: String(e) };
  }
}

function readProfile() {
  const key = Object.keys(localStorage).find((k) => k.startsWith("wb_delivery-points"));
  const dp = key ? JSON.parse(localStorage.getItem(key) || "{}") : {};
  const points = [...(dp.self ?? []), ...(dp.courier ?? [])]
    .filter((p) => !p.is_deleted)
    .map((p) => ({
      id: String(p.id),
      address: p.address ?? null,
      type: p.pointTypeName ?? p.deliveryType ?? null,
      work_time: p.workTime ?? null,
      main: Boolean(p.isMainAddress),
      dest: p.dest ?? null,
    }));
  const main = points.find((p) => p.main) ?? points[0];
  return { loggedIn: Boolean(localStorage.getItem("wbx__tokenData")), dest: (main?.dest ?? null) as number | null, points };
}
