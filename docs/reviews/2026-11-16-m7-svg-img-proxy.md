# 代码审查报告：M7 图片代理 SVG 纵深防御（issue #93）

**日期**：2026-11-16
**固定点**：`f50243b`（改动前 HEAD）
**审查范围**：`git diff f50243b...HEAD`（提交 `908746d` 实现 + follow-up 措辞修复）
**双轴**：Standards + Spec，并行子代理独立审查。

---

## Standards

**HARD（1 项，已修）**：

1. `README.md:502` / `img_proxy.ts:48,592` 称沙箱 CSP「与 media.ts 口径一致」不实——`media.ts:313` 只有 attachment + nosniff、无 CSP。→ follow-up 改为「attachment 处置与 media 一致，沙箱 CSP 是代理通道额外纵深防御」。

**JUDGEMENT（4 项）**：

| #   | 位置                        | finding                                                                                                           | 处置                                                                                                                                                                                                                                                    |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `withSecurityHeaders:19-24` | 「总是 set CSP」改「仅无 CSP 时 set」是全路由语义变更；沙箱 CSP 缺默认 CSP 的 `frame-ancestors` / `base-uri` 指令 | **接受**：必要配套（否则沙箱在统一出口被抹掉），默认 CSP 串逐字未变、L7 未触碰；全仓仅 img-proxy 自设 CSP，无回归。SVG 以 attachment 下载不嵌 iframe、沙箱禁脚本，两指令在该场景非必需；票面验收写死 `default-src 'none'; sandbox` 精确串，不额外加指令 |
| 2   | 缓存 `meta.ct`              | KV metadata 可被投毒：若 `text/html` + SVG body，svgSafeHeaders 返回 `{}` → 缺口                                  | **接受**：写入侧 MIME 白名单（`ALLOWED_IMAGE_MIME`）保证 ct 只能是图片类型，非现成可达；属残留信任风险，关票记录                                                                                                                                        |
| 3   | 静态源码守卫                | `slice(index+200)` 找 `...svgSafeHeaders` 与排版耦合                                                              | **接受**：审查已独立确认两路径均调用（:593/:684），守卫是防未来回归的额外保险，非唯一证据                                                                                                                                                               |
| 4   | GLOSSARY CSP 单源           | img-proxy 新增第二处硬编码 CSP 偏离单源模型                                                                       | **接受**：沙箱 CSP 是专用于 SVG 响应的纵深防御常量，非页面 CSP 策略的一部分，与 GLOSSARY 描述的页面 CSP 单源不冲突                                                                                                                                      |

（nosniff 在 svgSafeHeaders 与 withSecurityHeaders 同值重复设置，无冲突。）

**最严重（Standards）**：HARD-1 契约失真（已修）。

---

## Spec

**(a) 验收缺失/部分**

- 「关闭评论实测确认 `<img src>` 展示不受 attachment 影响」：单测无法证明浏览器行为；**关票评论须记录实测结论**（attachment 只影响导航/下载，不阻止 `<img>` 内联渲染，是 HTTP 标准行为）。
- 「关闭评论记录代理层是否净化 SVG 的评估结论」：**关票评论须写明**（本票选「不净化 + 响应头纵深防御」，理由：SVG 净化需完整 XML 解析，sanitize-html 是 HTML 解析器对 SVG 命名空间不可靠；attachment + 沙箱 + nosniff 已阻断执行面）。
- 「npm run check 全绿」：worker 无 check 脚本，验收指根包 astro check + worker typecheck，均绿。

**(b) scope creep**

- withSecurityHeaders 语义变更：保留 handler 自设 CSP 是沙箱生效的必需配套，默认 CSP 串未变，不算越界。

**(c) 实现有误**

- 无。`default-src 'none'; sandbox` 精确串正确，cache-hit / cache-miss 两路径均调用（审查独立确认）。

**核对通过**：非 SVG 响应头不变（withSecurityHeaders 仍注入默认 CSP）；CSP 主策略逐字未变（L7 未触碰）；未涉 SSRF / DoH（H10 out-of-scope）。

**最严重（Spec）**：关票评论待补的两项实测/评估结论（非代码缺陷）。

---

## 门禁（修复后）

- Worker：41 files / 384 tests PASS；typecheck 0 errors。
- 根包：44 files / 518 tests PASS；`npm run check` 0 errors；README 契约测试 13 PASS。
