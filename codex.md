# Codex 工作记录与发布流程

本文档记录本项目本轮修复、GitHub Actions 自动打包、发布流程，以及后续 Codex 维护规则。

## 后续维护硬规则

1. **每次修复代码或流程后都必须提交 Git commit**
   - 修复完成后先做必要验证；
   - 验证通过或已明确记录风险后，执行 `git add` + `git commit`；
   - commit message 使用简洁 Conventional Commits，例如：
     - `fix: guard ai response fallback`
     - `ci: configure tauri updater signing`
     - `docs: document codex release workflow`

2. **不要主动更新 release/tag**
   - 除非用户明确要求“触发 Actions / 打包 / 发布 / 更新 release / 更新 tag”；
   - 平常修 bug 只推 `main`，不执行：
     - `git tag -f ...`
     - `git push --force origin v...`
     - `gh release upload ...`
     - 任何会更新 GitHub Release 的操作。

3. **严禁提交敏感凭据**
   - 不提交 GitHub PAT、Tauri 私钥、updater 密码、`.env.local` 等；
   - 每次提交前做敏感关键字扫描；
   - 本项目已将 Tauri signing key 文件加入 `.gitignore`。

4. **优先基于真实运行证据排查**
   - GitHub Actions 报错必须先看最新 run/job 日志；
   - 不要用旧 run 的错误覆盖新 run；
   - 如果流程是顺序构建，后续平台 skipped 可能只是前置平台失败。

## 当前 release 目标

当前版本：

```text
5.28.8
```

当前 tag：

```text
v5.28.8
```

主发布 workflow：

```text
.github/workflows/build.yml
```

构建顺序已按用户要求改为：

```text
Resolve release tag
  -> Build (Windows)
  -> Build (Linux)
  -> Build (macOS-ARM / macOS-Intel)
  -> Create Release
```

原因：先让 Windows 产物出来，再跑 Linux，最后跑 macOS，方便定位和控制失败面。

## 已完成的关键修复

### 1. AI 对话完成提醒与兜底

已加入 AI 执行完成后的提醒能力，并修复渠道返回数据兼容问题。

重点防护：

```text
undefined is not an object (evaluating 'j.question.replace')
Cannot read properties of undefined (reading 'replace')
```

处理原则：

- 不假设第三方/渠道返回字段完整；
- 对 `question`、消息文本、会话元数据等做类型兜底；
- 避免直接对可能为 `undefined` 的值调用 `.replace()`；
- 对 AI 完成、失败、取消等状态给用户明确反馈。

### 2. 会话取消与进程隔离

修复方向：

- 取消单个对话时，只终止该对话绑定的进程/进程组；
- 不再按进程名或全局扫描误杀；
- Linux/Ubuntu 下避免 kill 到系统其它软件；
- 会话历史遍历与正在进行的会话解耦，避免扫描历史时断开所有对话。

Unix 侧关键点：

```text
src-tauri/src/commands/claude/platform/unix.rs
```

进程终止应走受控的 process registry / process group，不能做宽泛的系统级 kill。

### 3. P95 性能与人性化优化

修复方向：

- 遍历单项目所有会话历史时降低阻塞；
- 避免同步重扫造成 UI 卡顿或进程断连；
- 减少重复 IO；
- 对长耗时操作提供明确状态、提醒、错误信息；
- 更好地区分“执行中 / 已完成 / 已取消 / 失败”。

### 4. GitHub Actions env 解析错误

用户曾手动触发 workflow 报错：

```text
Failed to queue workflow run: Invalid Argument - failed to parse workflow:
(Line: 140, Col: 9): Unrecognized named-value: 'env'.
Located at position 12 within expression: startsWith(env.RELEASE_TAG, 'v')
```

根因：GitHub Actions 某些 job-level `if:` 不能直接引用 workflow-level `env`。

修复：新增 `resolve-release` job，通过 outputs 传递：

```yaml
outputs:
  release_tag: ${{ steps.resolve.outputs.release_tag }}
  is_release: ${{ steps.resolve.outputs.is_release }}
```

后续 job 用：

```yaml
if: needs.resolve-release.outputs.is_release == 'true'
```

job 内再设置：

```yaml
env:
  RELEASE_TAG: ${{ needs.resolve-release.outputs.release_tag }}
```

### 5. macOS/Linux 编译失败：Unix `Command` 未导入

旧 run 中 macOS ARM、macOS Intel、Linux 均失败：

```text
error[E0425]: cannot find type `Command` in this scope
--> src/commands/claude/platform/unix.rs:30:44
```

根因：Windows 本地 `cargo check` 不会编译 Unix/macOS 专属文件，导致 `unix.rs` 缺少导入没被发现。

修复：

```rust
use std::process::Command;
```

文件：

```text
src-tauri/src/commands/claude/platform/unix.rs
```

### 6. Windows 构建失败：Tauri updater signing key 无效

后续 run 中实际失败点是 Windows：

```text
failed to decode secret key: incorrect updater private key password: Missing comment in secret key
```

重要判断：

- Windows exe 已构建成功；
- MSI/NSIS bundle 已生成；
- 失败发生在 Tauri 生成 updater `.sig` 阶段；
- Linux/macOS skipped 是因为 Windows 作为前置 job 失败。

修复：

1. 生成新的 Tauri updater signing key；
2. 将私钥和密码写入 GitHub Actions secrets：
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
3. 更新 `src-tauri/tauri.conf.json` 中匹配的 `plugins.updater.pubkey`；
4. 将 updater endpoint 改为当前 fork 仓库：

```text
https://github.com/xzzvsxd/Any-code-remater/releases/latest/download/latest.json
```

本地保留文件：

```text
.tauri-signing-key
.tauri-signing-key.password
.tauri-signing-key.pub
```

这些文件已加入 `.gitignore`，不要提交。

## GitHub Actions 发布流程

### 常规修复流程

只修代码，不发布：

```powershell
git status --short
# 修改代码
npm run build
cd src-tauri
cargo check
cd ..
git diff --check
git add <changed-files>
git commit -m "fix: short description"
git push origin main
```

不要更新 tag，不要触发 release，除非用户明确要求。

### 用户明确要求发布时

如果用户明确说“触发 actions / 打包最新版本 / 发布 release / 更新 tag”，再执行：

```powershell
git status --short
npm run build
cd src-tauri
cargo check
cd ..
```

workflow 校验：

```powershell
$env:GOBIN = Join-Path (Get-Location) '.tmp-tools'
New-Item -ItemType Directory -Force -Path $env:GOBIN | Out-Null
go install github.com/rhysd/actionlint/cmd/actionlint@latest
.\.tmp-tools\actionlint.exe .github\workflows\build.yml
Remove-Item -Recurse -Force .tmp-tools
```

提交：

```powershell
git add <changed-files>
git commit -m "ci: short description"
git push origin main
```

仅在用户要求发布时更新 tag：

```powershell
git tag -f -a v5.28.8 -m "Release v5.28.8" HEAD
git push --force origin v5.28.8
```

这会触发：

```text
.github/workflows/build.yml
```

### 查看 Actions 状态

公开状态可用 GitHub API：

```powershell
$headers = @{ 'Accept'='application/vnd.github+json'; 'User-Agent'='codex-cli' }
$runs = Invoke-RestMethod -Headers $headers -Uri 'https://api.github.com/repos/xzzvsxd/Any-code-remater/actions/runs?per_page=10'
$runs.workflow_runs | Select-Object id,name,event,status,conclusion,head_branch,head_sha,html_url | Format-Table -AutoSize
```

查看某个 run 的 jobs：

```powershell
$runId = '<RUN_ID>'
$jobs = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/xzzvsxd/Any-code-remater/actions/runs/$runId/jobs?per_page=100"
$jobs.jobs | Select-Object id,name,status,conclusion,started_at,completed_at,html_url | Format-Table -AutoSize
```

下载私有/需要鉴权的 job 日志时，可从 Git Credential Manager 取 token，但**不要打印 token**：

```powershell
$credInput = "protocol=https`nhost=github.com`n`n"
$cred = $credInput | git credential-manager get 2>$null
if (-not $cred) { $cred = $credInput | git credential fill 2>$null }
$token = ($cred | Select-String '^password=' | ForEach-Object { $_.Line.Substring(9) } | Select-Object -First 1)

$headers = @{
  'Accept'='application/vnd.github+json'
  'User-Agent'='codex-cli'
  'Authorization'="Bearer $token"
}

New-Item -ItemType Directory -Force -Path .tmp-action-logs | Out-Null
Invoke-WebRequest -Headers $headers `
  -Uri "https://api.github.com/repos/xzzvsxd/Any-code-remater/actions/jobs/<JOB_ID>/logs" `
  -OutFile ".tmp-action-logs/job-<JOB_ID>.log" `
  -MaximumRedirection 5
```

日志分析：

```powershell
rg -n "##\[error\]|error\[|error:|failed|Failed|Exit code|exited with code|panic|No such|not found|Cannot|denied|tauri|bundle|msi|nsis|dmg|rustc|could not compile" .tmp-action-logs\job-<JOB_ID>.log -S -C 4
```

分析完清理：

```powershell
Remove-Item -Recurse -Force .tmp-action-logs -ErrorAction SilentlyContinue
```

## 发布产物与 updater

Tauri 配置：

```text
src-tauri/tauri.conf.json
```

关键字段：

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/xzzvsxd/Any-code-remater/releases/latest/download/latest.json"
      ],
      "dialog": false,
      "pubkey": "..."
    }
  },
  "bundle": {
    "createUpdaterArtifacts": true,
    "targets": "all"
  }
}
```

`createUpdaterArtifacts: true` 会要求有效 signing key。Actions 中必须存在：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

如果缺失或不匹配，会出现：

```text
failed to decode secret key
incorrect updater private key password
Missing comment in secret key
```

## 提交前验证清单

每次提交前至少执行：

```powershell
git status --short
npm run build
cd src-tauri
cargo check
cd ..
git diff --check
```

如果改了 workflow，再执行：

```powershell
$env:GOBIN = Join-Path (Get-Location) '.tmp-tools'
New-Item -ItemType Directory -Force -Path $env:GOBIN | Out-Null
go install github.com/rhysd/actionlint/cmd/actionlint@latest
.\.tmp-tools\actionlint.exe .github\workflows\build.yml
Remove-Item -Recurse -Force .tmp-tools
```

敏感信息扫描示例：

```powershell
$secretPatterns = @(
  'github_pa' + 't',
  'gh' + 'p_',
  'AHD3C' + 'KA',
  'TAURI_SECRET_PRIVATE_KEY' + '_VALUE',
  'GH_TOKEN' + '_FOR_SECRETS'
) -join '|'

rg -n $secretPatterns . --hidden `
  --glob '!node_modules/**' `
  --glob '!target/**' `
  --glob '!dist/**' `
  --glob '!.git/**' `
  --glob '!.tmp-action-logs/**' `
  --glob '!.tauri-signing-key' `
  --glob '!.tauri-signing-key.pub' `
  --glob '!.tauri-signing-key.password'
```

`rg` exit code 1 表示没有匹配，是期望结果。示例里用字符串拼接，避免扫描命令自身误报。

## 排障经验

1. **先看最新 run，不要看旧 run**
   - 同一个 tag 可能被 force-update 多次；
   - 旧失败 run 可能不代表当前问题。

2. **顺序构建时 skipped 不一定是该平台有问题**
   - 如果 Windows 失败，Linux/macOS 会 skipped；
   - 先修第一个失败 job。

3. **Windows 本地检查覆盖不到 Unix/macOS cfg**
   - `cargo check` 在 Windows 不会检查 Unix 专属模块；
   - Unix/macOS 错误需要看 Linux/macOS Actions 日志。

4. **Tauri updater signing 错误通常发生在 bundle 已生成之后**
   - 看日志中是否已有 `.msi`、`setup.exe`、`.AppImage`、`.dmg`；
   - 如果产物已生成但 job 失败，多半是 updater `.sig` 生成失败。

5. **不要把修复和发布混在一起**
   - 普通修复：commit + push main；
   - 发布：只有用户明确要求时才更新 tag/release。

## 最近关键提交

```text
33d3593 ci: configure tauri updater signing
70fea8c fix: import unix command type
d5d78f1 ci: build release platforms sequentially
bece437 fix: harden ai execution release
1914eab ci: support manual release tag dispatch
```
