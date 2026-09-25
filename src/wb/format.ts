// Адреса WB и мелкие преобразования
export const SITE = "https://www.wildberries.ru";

/** Цены в API WB — в копейках */
export const rub = (kopecks: unknown): number | null => (typeof kopecks === "number" ? Math.round(kopecks) / 100 : null);

export const productUrl = (nm: string | number) => `${SITE}/catalog/${nm}/detail.aspx`;

/** Артикул из артикула или ссылки wildberries.ru/catalog/<nm>/detail.aspx */
export function resolveNm(input: string): string {
  const text = input.trim();
  const nm = text.match(/catalog\/(\d{4,})/)?.[1] ?? text.match(/^\d{4,}$/)?.[0] ?? text.match(/[?&]nm=(\d{4,})/)?.[1];
  if (!nm) throw new Error(`Не удалось найти артикул WB в "${input}"`);
  return nm;
}

export const fromUnix = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

/** Время трекера статусов — в наносекундах */
export const fromNano = (ns: number | string | null | undefined) => (ns ? new Date(Number(String(ns).slice(0, 13))).toISOString() : null);

/** Сколько дней осталось до даты (округление вверх) */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  return Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000);
}
