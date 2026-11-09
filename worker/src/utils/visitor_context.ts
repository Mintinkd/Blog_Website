/**
 * SSR 转发契约的 Worker 侧还原（issue #54 / READER_ANALYTICS §3）。
 *
 * 只读 SSR 白名单头：缺失或空值一律 null，不合成默认 UA / Accept；
 * IP 只认 `X-Real-IP`、国家只认 `X-Visitor-Country`，避免把第二跳的
 * `CF-Connecting-IP`（Pages 出口地址）当成访客地址。供 #55 的过滤 /
 * 去重 / 维度使用；本票先锁定还原口径。
 */
export interface VisitorContext {
  ip: string | null;
  userAgent: string | null;
  accept: string | null;
  referer: string | null;
  acceptLanguage: string | null;
  secFetchMode: string | null;
  secFetchDest: string | null;
  secPurpose: string | null;
  purpose: string | null;
  xPurpose: string | null;
  country: string | null;
  /** `Sec-CH-UA*` 客户端提示，键为小写头名。 */
  clientHints: Readonly<Record<string, string>>;
}

export function readVisitorContext(request: Request): VisitorContext {
  const headers = request.headers;
  const clientHints: Record<string, string> = {};
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    if (!key.startsWith("sec-ch-ua")) continue;
    const hint = value.trim();
    if (hint) clientHints[key] = hint;
  }

  return {
    ip: headerValue(headers, "x-real-ip"),
    userAgent: headerValue(headers, "user-agent"),
    accept: headerValue(headers, "accept"),
    referer: headerValue(headers, "referer"),
    acceptLanguage: headerValue(headers, "accept-language"),
    secFetchMode: headerValue(headers, "sec-fetch-mode"),
    secFetchDest: headerValue(headers, "sec-fetch-dest"),
    secPurpose: headerValue(headers, "sec-purpose"),
    purpose: headerValue(headers, "purpose"),
    xPurpose: headerValue(headers, "x-purpose"),
    country: countryCode(headers.get("x-visitor-country")),
    clientHints,
  };
}

function headerValue(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.trim();
  return value ? value : null;
}

/** `CF-IPCountry` 是 ISO 3166-1 alpha-2（含 `T1` 等特殊值）；只接受两位字母/数字。 */
function countryCode(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z0-9]{2}$/.test(normalized) ? normalized : null;
}
