/**
 * 动态标签标题：离开挽留 / 回来欢迎（issue #103 / L4）。
 *
 * visibilitychange 挂在 document 上，ClientRouter 跨页后依然有效。
 */
export function initDynamicTitle(): void {
  const AWAY_MSG = "/(ㄒoㄒ)/~~ 不要走嘛";
  const BACK_MSG = "ヾ(≧▽≦*)o 欢迎回来～";
  const TITLES = [AWAY_MSG, BACK_MSG];
  let restoreTimer: number | undefined;

  // 记录页面自己的标题（跳过文案态，避免把文案当原标题）
  const snapshotTitle = () => {
    if (!TITLES.includes(document.title)) {
      (window as any).__blogOrigTitle = document.title;
    }
  };

  snapshotTitle();
  // ClientRouter 跨页后标题已被 Astro 更新，刷新快照
  document.addEventListener("astro:page-load", () => {
    if (!document.hidden) snapshotTitle();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // 离开：持续显示挽留语
      window.clearTimeout(restoreTimer);
      if (document.title !== AWAY_MSG) {
        snapshotTitle();
        document.title = AWAY_MSG;
      }
    } else {
      // 回来：先短暂显示欢迎语，再恢复原标题
      window.clearTimeout(restoreTimer);
      document.title = BACK_MSG;
      restoreTimer = window.setTimeout(() => {
        if (!document.hidden)
          document.title = (window as any).__blogOrigTitle || document.title;
      }, 1800);
    }
  });
}
