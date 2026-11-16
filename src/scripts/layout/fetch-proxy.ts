/**
 * 外链文字 / 接口内容自动降级代理（issue #103 / L4）。
 *
 * 用法：`const res = await window.fetchWithProxy('https://外部接口/xxx', { headers: {...} })`。
 * 返回标准 Response；调用方仅作文本 / JSON 解析，勿 innerHTML 注入（防 XSS）。
 *
 * 域级自适应：直连失败（含证书 / 安全层拦截）→ 走 `/api/v1/text-proxy` 兜底；
 * 代理成功说明目标本身可达、问题在直连链路 → 记住该域 7 天，期内直接走代理
 * （浏览器不再直连，从源头避免「不安全」）；其余域始终直连，不受影响。
 */
export function initFetchWithProxy(): void {
  const PROXY_BAD_KEY = "fetch-proxy-domains";
  const PROXY_BAD_TTL = 7 * 24 * 60 * 60 * 1000;
  const loadProxyBad = (): Record<string, number> => {
    try {
      const raw = localStorage.getItem(PROXY_BAD_KEY);
      const o = raw ? JSON.parse(raw) : {};
      return o && typeof o === "object" ? (o as Record<string, number>) : {};
    } catch {
      return {};
    }
  };
  const saveProxyBad = (o: Record<string, number>) => {
    try {
      localStorage.setItem(PROXY_BAD_KEY, JSON.stringify(o));
    } catch {
      /* 隐私模式等忽略 */
    }
  };
  const buildProxyUrl = (target: string) =>
    location.origin + "/api/v1/text-proxy?url=" + encodeURIComponent(target);
  const proxyRequest = async (
    target: string,
    init?: RequestInit
  ): Promise<Response> => {
    // 代理请求不携带原 signal：直连因超时中断时仍需走代理（Worker 端自带 10s 超时保护）
    try {
      return await fetch(buildProxyUrl(target), {
        method: "GET",
        headers: {
          Accept:
            (init && init.headers && (init.headers as any).Accept) ||
            "application/json,text/plain,*/*",
        },
      });
    } catch {
      return new Response(
        JSON.stringify({ code: 502, message: "代理兜底失败", data: null }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };
  window.fetchWithProxy = async (
    input: RequestInfo | URL,
    init?: RequestInit,
    opts?: { forceProxy?: boolean }
  ): Promise<Response> => {
    const target =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    let host = "";
    try {
      host = new URL(target).hostname;
    } catch {
      /* 非法 URL 也交由代理路径处理 */
    }
    const bad = loadProxyBad();
    const now = Date.now();
    // forceProxy，或该域已被标记「直连链路异常」（7 天内）→ 直接走代理，浏览器不直连目标
    if (
      (opts && opts.forceProxy) ||
      (host && bad[host] !== undefined && now - bad[host] < PROXY_BAD_TTL)
    ) {
      return proxyRequest(target, init);
    }
    try {
      const res = await fetch(input, init);
      if (res.ok) {
        // 直连成功：若该域曾被标记异常，说明已恢复，清除标记
        if (host && bad[host] !== undefined) {
          delete bad[host];
          saveProxyBad(bad);
        }
        return res; // 直连正常：直接返回，不影响体验
      }
      return res; // 非 2xx：服务器可达，原样返回，不算直连链路问题
    } catch {
      // 直连失败（含证书/安全层拦截、网络/CORS）：走代理兜底
      const r = await proxyRequest(target, init);
      // 代理成功而直连失败 → 目标本身可达，问题在直连链路（如证书警告）→ 记住该域，期内不再直连
      if (r.ok && host) {
        bad[host] = now;
        saveProxyBad(bad);
      }
      return r;
    }
  };
}
