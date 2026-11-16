import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../src/utils/sanitizer";
import {
  RICH_TEXT_TAGS,
  RICH_TEXT_ATTRIBUTES,
  RICH_TEXT_SCHEMES,
  RICH_TEXT_FORBID_CONTENT_TAGS,
} from "../src/generated/rich-text-policy";

/**
 * issue #92 / M6 + #99 / M19：Worker 消毒器白名单化 + XSS 回归。
 *
 * 接缝：sanitizeHtml 纯函数（评论 / 导入文章入库路径）。
 * 5 类已知绕过载荷（报告 §M19）必须不穿透；合法正文标签/属性保留。
 * 期望值全部手写字面量，不从被测实现反推。
 */

describe("5 类已知 XSS 载荷不穿透（issue #92）", () => {
  it("1. 未闭合 <script src=//evil.com>", () => {
    const out = sanitizeHtml("<p>ok</p><script src=//evil.com>alert(1)");
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/evil\.com/i);
  });

  it("2. href javascript 实体绕过 javascript&#58; / &#x6a;avascript", () => {
    for (const payload of [
      '<a href="javascript&#58;alert(1)">x</a>',
      '<a href="java&#x73;cript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
    ]) {
      const out = sanitizeHtml(payload);
      expect(out, payload).not.toMatch(/javascript/i);
      expect(out, payload).not.toMatch(/alert/i);
    }
  });

  it("3. onerror / onload 等事件属性", () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)" onload=evil()>');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/onload/i);
  });

  it("4. <svg onload> / <foreignObject> / <animate>", () => {
    const out = sanitizeHtml(
      '<svg onload="alert(1)"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject><animate onbegin="evil()"/></svg>'
    );
    expect(out).not.toMatch(/<svg/i);
    expect(out).not.toMatch(/foreignobject/i);
    expect(out).not.toMatch(/<animate/i);
    expect(out).not.toMatch(/alert/i);
  });

  it("5. <meta http-equiv> / <base href> / <frameset> / <iframe>", () => {
    const out = sanitizeHtml(
      '<meta http-equiv="refresh" content="0;url=//evil"><base href="//evil"><frameset><frame src="//evil"></frameset><iframe src="//evil"></iframe>'
    );
    expect(out).not.toMatch(/<meta/i);
    expect(out).not.toMatch(/<base/i);
    expect(out).not.toMatch(/<frame/i);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/evil/i);
  });

  it("data:text/html 与 vbscript scheme 被拒", () => {
    expect(
      sanitizeHtml('<a href="data:text/html,<script>x</script>">x</a>')
    ).not.toMatch(/data:/i);
    expect(sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>')).not.toMatch(
      /vbscript/i
    );
  });
});

describe("合法正文消毒后不丢失允许内容（issue #92）", () => {
  it("白名单标签与属性保留：标题/段落/链接/图片/代码", () => {
    const input =
      '<h2 class="t" id="s1">标题</h2><p>段落 <strong>粗</strong> <em>斜</em></p>' +
      '<a href="https://example.com" title="链接" rel="nofollow">站点</a>' +
      '<img src="https://example.com/a.png" alt="图" title="t">' +
      '<pre><code class="language-js">const a=1;</code></pre>' +
      "<blockquote>引用</blockquote><ul><li>项</li></ul>";
    const out = sanitizeHtml(input);
    for (const frag of [
      "<h2",
      'class="t"',
      'id="s1"',
      "<strong>粗</strong>",
      "<em>斜</em>",
      'href="https://example.com"',
      'rel="nofollow"',
      "<img",
      'alt="图"',
      'class="language-js"',
      "<blockquote>",
      "<li>项</li>",
    ]) {
      expect(out, `应保留 ${frag}`).toContain(frag);
    }
  });

  it("表格结构保留", () => {
    const out = sanitizeHtml(
      "<table><thead><tr><th>列</th></tr></thead><tbody><tr><td>值</td></tr></tbody></table>"
    );
    expect(out).toContain("<table>");
    expect(out).toContain("<th>列</th>");
    expect(out).toContain("<td>值</td>");
  });

  it("data-* / aria-* 通配属性保留", () => {
    const out = sanitizeHtml('<p data-x="1" aria-label="y">ok</p>');
    expect(out).toContain('data-x="1"');
    expect(out).toContain('aria-label="y"');
  });
});

describe("白名单常量被真正消费（issue #92 / M6）", () => {
  it("生成物常量非空且含关键项（防呆：常量未被清空/未引用前先钉形状）", () => {
    expect(RICH_TEXT_TAGS).toContain("p");
    expect(RICH_TEXT_TAGS).toContain("a");
    expect(RICH_TEXT_TAGS).not.toContain("script");
    expect(RICH_TEXT_ATTRIBUTES).toContain("href");
    expect(RICH_TEXT_SCHEMES).toContain("https");
    expect(RICH_TEXT_FORBID_CONTENT_TAGS).toContain("svg");
  });

  it("消毒器不再使用正则黑名单：script 内容整段丢弃而非仅剥标签", () => {
    // 旧黑名单只删 <script>...</script> 标签对，未闭合脚本的正文「alert(1)」会残留。
    // 白名单消毒器把 script 列为 nonTextTags，整段连内容丢弃。
    const out = sanitizeHtml("before<script>alert(1)</script>after");
    expect(out).not.toMatch(/alert/i);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });
});
