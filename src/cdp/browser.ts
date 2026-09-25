// Вкладки браузера, выполнение в них JS и ввод (клики, текст) — всё, что нужно от Chrome
import { CdpConnection } from "./connection.js";

export type PageInfo = { targetId: string; url: string };

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Browser {
  private connecting: Promise<CdpConnection> | null = null;
  /** targetId вкладки -> sessionId, через который в ней выполняются команды */
  private sessions = new Map<string, string>();

  constructor(private cdpUrl: string) {}

  private async connection(): Promise<CdpConnection> {
    if (this.connecting) {
      const conn = await this.connecting.catch(() => null);
      if (conn?.isConnected) return conn;
    }
    this.connecting = CdpConnection.connect(this.cdpUrl).then((conn) => {
      this.sessions.clear();
      conn.on("Target.detachedFromTarget", ({ targetId }) => this.sessions.delete(targetId));
      conn.on("close", () => (this.connecting = null));
      return conn;
    });
    return this.connecting;
  }

  async pages(): Promise<PageInfo[]> {
    const conn = await this.connection();
    const { targetInfos } = await conn.send<{ targetInfos: (PageInfo & { type: string })[] }>("Target.getTargets");
    return targetInfos.filter((t) => t.type === "page").map(({ targetId, url }) => ({ targetId, url }));
  }

  /** Открывает вкладку и ждёт, пока загрузится DOM (как goto с waitUntil: "domcontentloaded") */
  async openPage(url: string, timeoutMs = 45_000): Promise<PageInfo> {
    const conn = await this.connection();
    const { targetId } = await conn.send<{ targetId: string }>("Target.createTarget", { url });
    const page = { targetId, url };
    try {
      await this.waitFor(page, () => location.href !== "about:blank" && document.readyState !== "loading", timeoutMs);
    } catch (e) {
      await this.closePage(page);
      throw new Error(`Не удалось открыть ${url}: ${(e as Error).message}`);
    }
    return page;
  }

  /** Переход во вкладке на другой адрес с ожиданием загрузки DOM */
  async navigate(page: PageInfo, url: string, timeoutMs = 45_000): Promise<void> {
    await this.send(page, "Page.navigate", { url });
    await this.waitFor(page, () => document.readyState !== "loading", timeoutMs);
  }

  async closePage(page: PageInfo): Promise<void> {
    const conn = await this.connection();
    this.sessions.delete(page.targetId);
    await conn.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
  }

  /**
   * Выполняет функцию внутри вкладки и возвращает результат (он должен сериализоваться в JSON).
   * Функция переносится в браузер как текст, поэтому замыкания на переменные Node не работают.
   */
  evaluate<A extends unknown[], R>(page: PageInfo, fn: (...args: A) => R | Promise<R>, ...args: A): Promise<R> {
    return this.evaluateCode(page, `(${fn})(${args.map((a) => JSON.stringify(a) ?? "undefined").join(", ")})`);
  }

  /** Выполняет JS-выражение во вкладке (промис дожидается) */
  async evaluateCode<R>(page: PageInfo, expression: string): Promise<R> {
    const { result, exceptionDetails } = await this.send(page, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description?.split("\n")[0] ?? exceptionDetails.text);
    }
    return result.value as R;
  }

  /** Ждёт, пока условие во вкладке станет истинным. Переживает перезагрузки страницы. */
  async waitFor<A extends unknown[]>(page: PageInfo, predicate: (...args: A) => boolean, timeoutMs: number, ...args: A): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Во время навигации контекст страницы пересоздаётся и evaluate может упасть — просто пробуем ещё
      if (await this.evaluate(page, predicate, ...args).catch(() => false)) return;
      await sleep(250);
    }
    throw new Error("таймаут ожидания");
  }

  /** Настоящий клик мышью по первому элементу под селектором. false — элемента нет. */
  async click(page: PageInfo, selector: string): Promise<boolean> {
    const point = await this.evaluate(
      page,
      (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      selector
    );
    if (!point) return false;
    const mouse = { ...point, button: "left", clickCount: 1 };
    await this.send(page, "Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await this.send(page, "Input.dispatchMouseEvent", { type: "mousePressed", ...mouse });
    await this.send(page, "Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse });
    return true;
  }

  /** Заменяет текст в поле ввода, как если бы его напечатали. false — поля нет. */
  async fill(page: PageInfo, selector: string, text: string): Promise<boolean> {
    const found = await this.evaluate(
      page,
      (selector) => {
        const el = document.querySelector<HTMLInputElement>(selector);
        if (!el) return false;
        el.scrollIntoView({ block: "center" });
        el.focus();
        el.select();
        return true;
      },
      selector
    );
    if (found) await this.send(page, "Input.insertText", { text });
    return found;
  }

  async pressEnter(page: PageInfo): Promise<void> {
    const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
    await this.send(page, "Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...key });
    await this.send(page, "Input.dispatchKeyEvent", { type: "keyUp", ...key });
  }

  /** Команда CDP в контексте вкладки */
  private async send(page: PageInfo, method: string, params: object): Promise<any> {
    const conn = await this.connection();
    let sessionId = this.sessions.get(page.targetId);
    if (!sessionId) {
      ({ sessionId } = await conn.send<{ sessionId: string }>("Target.attachToTarget", { targetId: page.targetId, flatten: true }));
      this.sessions.set(page.targetId, sessionId!);
      // Вкладка может быть в фоне: без эмуляции фокуса поля не принимают ввод
      await conn.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
    }
    return conn.send(method, params, sessionId);
  }
}
