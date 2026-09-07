/**
 * 分类 → 颜色 映射工具（安知鱼风格）
 *
 * 设计：
 * - 常见分类按语义关键词匹配专属色（与 anzhiyu 主题"每个分类一个主色"的做法一致）
 * - 未匹配的分类用固定色板按 slug 哈希稳定取色，保证同一分类永远同色
 * - 附带 hex 工具：hexToRgba / shade / 分类渐变背景 / 分类徽标样式（亮暗双主题自适应）
 */

const CATEGORY_COLOR_MAP: Record<string, string> = {
  // 技术 / 前端 / 开发 —— 安知鱼蓝
  前端: '#49b1f5', frontend: '#49b1f5', web: '#49b1f5',
  技术: '#3a9de8', tech: '#3a9de8', 开发: '#3a9de8', dev: '#3a9de8', 编程: '#3a9de8', code: '#3a9de8',
  // 网络安全 —— 红
  网络安全: '#e05d5d', 安全: '#e05d5d', security: '#e05d5d', hack: '#e05d5d',
  // 设计 / 绘图 —— 紫
  设计: '#9b72cf', design: '#9b72cf', 平面设计: '#9b72cf', 绘画: '#9b72cf', 绘图: '#9b72cf',
  // 生活 / 日常 —— 橙
  生活: '#f08a3c', life: '#f08a3c', 日常: '#f08a3c', daily: '#f08a3c',
  // 随笔 / 杂谈 —— 绿
  随笔: '#5cb87a', essay: '#5cb87a', 杂谈: '#5cb87a', talk: '#5cb87a',
  // 教程 / 学习 —— 青
  教程: '#17a2b8', tutorial: '#17a2b8', 学习: '#17a2b8', study: '#17a2b8',
  // 游戏 —— 靛蓝
  游戏: '#6366f1', game: '#6366f1',
  // 大学 / 学生 —— 金黄
  大学: '#e8a33d', student: '#e8a33d', college: '#e8a33d',
  // 音乐 —— 玫红
  音乐: '#ec6b9b', music: '#ec6b9b',
  // 年度总结 —— 紫红
  总结: '#d3549e', 年度: '#d3549e', annual: '#d3549e',
  // 职场 / 工作 / 面试 —— 灰蓝
  职场: '#6c7a89', work: '#6c7a89', 面试: '#6c7a89', job: '#6c7a89',
};

const FALLBACK_PALETTE = [
  '#49b1f5', '#f08a3c', '#5cb87a', '#9b72cf', '#e05d5d',
  '#17a2b8', '#ec6b9b', '#e8a33d', '#6366f1', '#6c7a89',
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/** 依据分类 slug/name 稳定取色 */
export function getCategoryColor(slug?: string | null, name?: string | null): string {
  const key = (slug || name || '').toLowerCase().trim();
  if (key) {
    for (const [k, v] of Object.entries(CATEGORY_COLOR_MAP)) {
      if (key === k || key.includes(k) || k.includes(key)) return v;
    }
  }
  return FALLBACK_PALETTE[Math.abs(hashCode(key || 'default')) % FALLBACK_PALETTE.length];
}

export function hexToRgba(hex: string, alpha: number): string {
  let h = (hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt((h + '000000').slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 加深(percent<0)/提亮(percent>0)，percent 取值 -100 ~ 100 */
export function shade(hex: string, percent: number): string {
  let h = (hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt((h + '000000').slice(0, 6), 16);
  const adjust = (v: number) => {
    const target = percent < 0 ? 0 : 255;
    const p = Math.abs(percent) / 100;
    return Math.round((target - v) * p + v);
  };
  const r = adjust((n >> 16) & 255);
  const g = adjust((n >> 8) & 255);
  const b = adjust(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** 分类渐变背景：亮色用浅色、暗色用深色，保证文字对比度 */
export function categoryGradient(color: string, dark: boolean): string {
  const a1 = dark ? 0.28 : 0.13;
  const a2 = dark ? 0.1 : 0.03;
  return `linear-gradient(135deg, ${hexToRgba(color, a1)} 0%, ${hexToRgba(color, a2)} 100%)`;
}

/** 分类徽标 inline 样式（亮暗双主题自适应） */
export function categoryBadgeStyle(color: string, dark: boolean): Record<string, string> {
  return {
    background: hexToRgba(color, dark ? 0.26 : 0.13),
    color: dark ? shade(color, 40) : shade(color, -28),
    border: `1px solid ${hexToRgba(color, dark ? 0.45 : 0.3)}`,
  };
}
