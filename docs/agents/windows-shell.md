# Windows shell

OpenCode 的 shell 以 `pwsh -NoLogo -NoProfile -NonInteractive` 启动，代码页默认 936（GBK）。profile 不会加载，`chcp 65001` 单独也修不好原生命令的 UTF-8 解码。

## 原生命令输出

`gh --json`、带中文的 `git` 输出等是 UTF-8；被 PowerShell 按 GBK 解码后会变成 `�?`，`ConvertFrom-Json` 也可能失败。需要机器解析时，在命令前加：

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
```

已验证这两行足够，不需要 `chcp`。也可以用 `scripts/gh.ps1`（内置同样设置；读写工单、带中文 `--body` 都建议用它）：

```powershell
.\scripts\gh.ps1 issue view 36 --json number,title | ConvertFrom-Json
```

只是阅读工单时也用 `scripts/gh.ps1`；纯文本输出同样受控制台编码影响，不要假设 `gh` 直出一定正常。

## 文件与搜索

- 读仓库文件用 `read` 工具，不要用 `Get-Content`：UTF-8 中文文档可能显示成乱码。
- 搜索用 `grep` 工具；本机 PATH 没有 `rg`。
