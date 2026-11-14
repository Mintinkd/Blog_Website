/**
 * 中英文字数与阅读时长。
 *
 * 算法与 worker/src/services/article_service.ts 的 calculateReadingTime 逐步对齐：
 * 中文按 \u4e00-\u9fff / \u3400-\u4dbf 逐字计数（300 字/分），余下内容按空白
 * 切词计数（200 词/分），分钟数向上取整且最少 1 分钟。注意 Markdown 标记与
 * 中文标点会落入「英文词」计数，这是服务端既有口径，客户端不得擅自修正，
 * 否则元信息面板的阅读时长会与列表接口不一致。对齐样例见
 * tests/editor-word-count.test.ts（期望值均为手写字面量）。
 */
export const CHINESE_CHARS_PER_MINUTE = 300;
export const ENGLISH_WORDS_PER_MINUTE = 200;

/** 每次返回新正则，避免共享 lastIndex 影响 match / replace。 */
function cjkPattern(): RegExp {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/g;
}

export interface WordCount {
  chinese: number;
  english: number;
  total: number;
}

export function countWords(text: string): WordCount {
  const chinese = (text.match(cjkPattern()) || []).length;
  const english = text
    .replace(cjkPattern(), " ")
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  return { chinese, english, total: chinese + english };
}

export function readingTimeMinutes(text: string): number {
  const { chinese, english } = countWords(text);
  const minutes =
    chinese / CHINESE_CHARS_PER_MINUTE + english / ENGLISH_WORDS_PER_MINUTE;
  return Math.max(1, Math.ceil(minutes));
}
