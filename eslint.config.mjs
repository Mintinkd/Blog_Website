/**
 * ESLint flat config（issue #102 / L2）。
 *
 * 目标不是「套一份社区预设」，而是给本仓补上**死代码 / 未使用变量 / 重复定义**
 * 的自动化防线——`astro check` + `tsc` 只给 hint 不阻断，M15（重复 escape）、
 * M21（死代码）这类问题此前只能靠人工审查抓。
 *
 * 覆盖范围：根包 TS（`src` / `tests` / `scripts` / 根目录配置）、Vue SFC（src 下的 .vue）、
 * Worker TS（`worker/src` / `worker/tests`）。
 *
 * **刻意不覆盖 `.astro`**：`npm run check`（astro check）已对 .astro 的 frontmatter 做
 * 带类型的检查，而 eslint-plugin-astro 会再引入一套 parser + 规则重叠；本仓 .astro
 * 绝大多数是模板 + 少量脚本，收益低于维护面。理由记录在 #102 关票评论。
 *
 * 与 prettier 的分工：格式化全部交给 prettier（`.prettierrc`），本配置不启用任何
 * 风格类规则（缩进 / 引号 / 分号），因此无需 eslint-config-prettier。
 */
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import vue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import globals from "globals";

/**
 * 三处源码共用的关键规则。
 * - `no-unused-vars` 交给 TS 版本（核心实现不认类型引用，会对 `import type` 误报）；
 * - `no-redeclare` 拦「同名重复定义」；
 * - `no-dupe-keys` / `no-dupe-class-members` 拦对象与类内的重复成员。
 */
const TYPESCRIPT_KEY_RULES = {
  "no-unused-vars": "off",
  // 只查「用到的参数之后的未使用参数」：router handler 统一是 (request, env, ctx, params)
  // 的固定位置签名，大量 handler 只用到前两个——改成 args:"all" 会要求 39 处改成 _前缀，
  // 换来的只是签名可读性下降。真正的前置死参（如 mediaEmbed 的 title）由 astro check
  // 的 ts(6133) 兜住（build 输出里以后 hint 形式列出）。
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      args: "after-used",
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrors: "none",
      ignoreRestSiblings: true,
    },
  ],
  "no-redeclare": "error",
  "no-dupe-keys": "error",
  "no-dupe-class-members": "error",
  "no-unreachable": "error",
};

export default [
  {
    ignores: [
      "dist/**",
      ".astro/**",
      ".wrangler/**",
      "node_modules/**",
      "worker/dist/**",
      "worker/node_modules/**",
      "worker/.wrangler/**",
      "public/**",
      // 生成物由 `npm run gen:*` 单源产出，不参与手写代码检查
      "src/generated/**",
      "worker/src/generated/**",
      // 本地 agent 工作目录（临时产物 / 抓下来的线上 chunk），不是源码
      ".workbuddy/**",
      ".arts/**",
      "coverage/**",
    ],
  },

  // ① 纯 JS / MJS（构建与运维脚本）
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // 脚本里既有 node 用法，也有 Playwright `page.evaluate` 的浏览器上下文代码，
      // 两套全局并存（no-undef 只拦「两套都不认识」的名字）。
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          // 口径与 TS 块一致（after-used）：脚本里的 Playwright 回调也常带前置未用参数
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-undef": "error",
      "no-unreachable": "error",
    },
  },

  // ② 根包 TypeScript（src / tests / scripts 的类型声明 / 根配置）
  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...TYPESCRIPT_KEY_RULES,
      // TS 由编译器负责未声明标识符（含 `import type`），no-undef 在 TS 上是反模式
      "no-undef": "off",
    },
  },

  // ③ Vue SFC：模板 + `<script setup lang="ts">` 都走 TS 解析器
  ...vue.configs["flat/essential"].map((config) => ({
    ...config,
    files: ["**/*.vue"],
  })),
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsparser,
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: { ...globals.browser },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...TYPESCRIPT_KEY_RULES,
      "no-undef": "off",
      // 组件名 / 多词组件属风格约定，与本票目标无关
      "vue/multi-word-component-names": "off",
    },
  },
];
