//! WSL Gemini/Claude runtime detection helpers.

use std::path::PathBuf;
use std::sync::OnceLock;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::process::Command;

#[cfg(target_os = "windows")]
use log::{debug, info, warn};

use super::wsl_utils::{
    build_wsl_unc_path, get_claude_wsl_config, get_default_wsl_distro, get_gemini_wsl_config,
    get_wsl_distros, get_wsl_home_dir, is_native_claude_available, is_native_gemini_available,
    is_wsl_available, ClaudeMode, GeminiMode,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
use super::wsl_utils::build_wsl_path_for_program;

/// Gemini WSL 版本缓存
static GEMINI_WSL_VERSION_CACHE: OnceLock<Option<String>> = OnceLock::new();

pub fn check_wsl_gemini(distro: Option<&str>) -> Option<String> {
    // 首先尝试使用 which 命令（依赖 PATH）
    let mut cmd = Command::new("wsl");

    if let Some(d) = distro {
        cmd.arg("-d").arg(d);
    }

    cmd.args(["--", "which", "gemini"]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && path.starts_with('/') {
                info!("[Gemini WSL] Found gemini via 'which' at: {}", path);
                return Some(path);
            }
        }
        _ => {}
    }

    // which 失败时，直接探测常见安装路径
    debug!("[Gemini WSL] 'which gemini' failed, trying common paths...");

    // 获取 WSL 用户的 home 目录
    let wsl_home = get_wsl_home_dir(distro).unwrap_or_else(|| "/root".to_string());

    // 常见 Gemini CLI 安装路径（按优先级排序）
    let common_paths = vec![
        "/usr/local/bin/gemini".to_string(),
        "/usr/bin/gemini".to_string(),
        format!("{}/.local/bin/gemini", wsl_home),
        format!("{}/.npm-global/bin/gemini", wsl_home),
        format!("{}/.volta/bin/gemini", wsl_home),
        format!("{}/.asdf/shims/gemini", wsl_home),
        format!("{}/.nvm/current/bin/gemini", wsl_home),
        format!("{}/.bun/bin/gemini", wsl_home),
        "/home/linuxbrew/.linuxbrew/bin/gemini".to_string(),
        "/snap/bin/gemini".to_string(),
    ];

    for path in &common_paths {
        // 使用 test -x 检查文件是否存在且可执行
        let mut test_cmd = Command::new("wsl");
        if let Some(d) = distro {
            test_cmd.arg("-d").arg(d);
        }
        test_cmd.args(["--", "test", "-x", path]);
        test_cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(output) = test_cmd.output() {
            if output.status.success() {
                info!(
                    "[Gemini WSL] Found gemini via direct path check at: {}",
                    path
                );
                return Some(path.clone());
            }
        }
    }

    // 尝试扫描 nvm 安装的 Node.js 版本
    let nvm_versions_dir = format!("{}/.nvm/versions/node", wsl_home);
    let mut ls_cmd = Command::new("wsl");
    if let Some(d) = distro {
        ls_cmd.arg("-d").arg(d);
    }
    ls_cmd.args(["--", "ls", "-1", &nvm_versions_dir]);
    ls_cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = ls_cmd.output() {
        if output.status.success() {
            let versions = String::from_utf8_lossy(&output.stdout);
            for version in versions.lines() {
                let version = version.trim();
                if !version.is_empty() {
                    let gemini_path = format!("{}/{}/bin/gemini", nvm_versions_dir, version);
                    let mut test_cmd = Command::new("wsl");
                    if let Some(d) = distro {
                        test_cmd.arg("-d").arg(d);
                    }
                    test_cmd.args(["--", "test", "-x", &gemini_path]);
                    test_cmd.creation_flags(CREATE_NO_WINDOW);

                    if let Ok(test_output) = test_cmd.output() {
                        if test_output.status.success() {
                            info!(
                                "[Gemini WSL] Found gemini in nvm version {} at: {}",
                                version, gemini_path
                            );
                            return Some(gemini_path);
                        }
                    }
                }
            }
        }
    }

    debug!("[Gemini WSL] Gemini not found in any common paths");
    None
}

#[cfg(not(target_os = "windows"))]
pub fn check_wsl_gemini(_distro: Option<&str>) -> Option<String> {
    None
}

/// 获取 WSL 内 Gemini CLI 的版本（带缓存）
#[cfg(target_os = "windows")]
pub fn get_wsl_gemini_version(distro: Option<&str>) -> Option<String> {
    // 使用缓存避免频繁创建 WSL 进程
    GEMINI_WSL_VERSION_CACHE
        .get_or_init(|| {
            debug!("[WSL] Fetching Gemini version (first time)...");
            fetch_wsl_gemini_version(distro)
        })
        .clone()
}

/// 实际获取 WSL 内 Gemini CLI 的版本（内部函数）
#[cfg(target_os = "windows")]
fn fetch_wsl_gemini_version(distro: Option<&str>) -> Option<String> {
    let mut cmd = Command::new("wsl");

    if let Some(d) = distro {
        cmd.arg("-d").arg(d);
    }

    // 优先使用探测到的绝对路径，避免非交互环境 PATH 不包含 nvm/volta 等安装目录
    let program = check_wsl_gemini(distro).unwrap_or_else(|| "gemini".to_string());
    cmd.arg("--");
    cmd.arg(&program);
    cmd.arg("--version");
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                debug!("[WSL] Gemini version: {}", version);
                Some(version)
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_wsl_gemini_version(_distro: Option<&str>) -> Option<String> {
    None
}

/// Gemini WSL 运行时配置结构
#[derive(Debug, Clone, Default)]
pub struct GeminiWslRuntime {
    /// 是否启用 WSL 模式
    pub enabled: bool,
    /// WSL 发行版名称（如 "Debian", "Ubuntu"）
    pub distro: Option<String>,
    /// .gemini 目录的 Windows UNC 路径
    pub gemini_dir_unc: Option<PathBuf>,
    /// WSL 内 Gemini CLI 的路径（如 "/usr/local/bin/gemini"）
    pub gemini_path_in_wsl: Option<String>,
}

/// 全局 Gemini WSL 运行时配置缓存
static GEMINI_WSL_RUNTIME: OnceLock<GeminiWslRuntime> = OnceLock::new();

impl GeminiWslRuntime {
    /// 自动检测并创建 Gemini WSL 配置
    ///
    /// 检测策略（根据用户配置）：
    /// - Auto（默认）：原生优先，WSL 作为后备
    /// - Native：强制使用原生，不启用 WSL
    /// - Wsl：强制使用 WSL（如果可用）
    #[cfg(target_os = "windows")]
    pub fn detect() -> Self {
        let gemini_config = get_gemini_wsl_config();
        info!(
            "[Gemini WSL] Detecting Gemini configuration (mode: {:?})...",
            gemini_config.mode
        );

        match gemini_config.mode {
            GeminiMode::Native => {
                // 强制原生模式，不启用 WSL
                info!("[Gemini WSL] Mode set to Native, WSL disabled");
                return Self::default();
            }
            GeminiMode::Wsl => {
                // 强制 WSL 模式
                info!("[Gemini WSL] Mode set to WSL, attempting to use WSL Gemini...");
                return Self::detect_wsl_config(gemini_config.wsl_distro.as_deref());
            }
            GeminiMode::Auto => {
                // 自动模式：原生优先
                if is_native_gemini_available() {
                    info!("[Gemini WSL] Native Windows Gemini is available, WSL mode disabled");
                    return Self::default();
                }
                info!("[Gemini WSL] Native Gemini not found, checking WSL as fallback...");
                return Self::detect_wsl_config(gemini_config.wsl_distro.as_deref());
            }
        }
    }

    /// 检测 WSL 配置（内部方法）
    #[cfg(target_os = "windows")]
    fn detect_wsl_config(preferred_distro: Option<&str>) -> Self {
        if !is_wsl_available() {
            info!("[Gemini WSL] WSL is not available");
            return Self::default();
        }

        // 使用用户指定的发行版或默认发行版
        let distro = if let Some(d) = preferred_distro {
            // 验证用户指定的发行版是否存在
            let distros = get_wsl_distros();
            if distros.iter().any(|name| name == d) {
                info!("[Gemini WSL] Using user-specified distro: {}", d);
                Some(d.to_string())
            } else {
                warn!(
                    "[Gemini WSL] User-specified distro '{}' not found, using default",
                    d
                );
                get_default_wsl_distro()
            }
        } else {
            get_default_wsl_distro()
        };

        if distro.is_none() {
            info!("[Gemini WSL] No WSL distro found");
            return Self::default();
        }

        let Some(distro_name) = distro.as_deref() else {
            info!("[Gemini WSL] No WSL distro found");
            return Self::default();
        };
        info!("[Gemini WSL] Found WSL distro: {}", distro_name);

        let wsl_home = get_wsl_home_dir(Some(distro_name));
        info!("[Gemini WSL] WSL home directory: {:?}", wsl_home);

        let gemini_path_in_wsl = check_wsl_gemini(Some(distro_name));
        info!("[Gemini WSL] Gemini path in WSL: {:?}", gemini_path_in_wsl);

        let gemini_dir_unc = if let Some(ref home) = wsl_home {
            let wsl_gemini_path = format!("{}/.gemini", home);
            let unc_path = build_wsl_unc_path(&wsl_gemini_path, distro_name);
            if unc_path.exists() {
                info!("[Gemini WSL] Found .gemini directory at: {:?}", unc_path);
                Some(unc_path)
            } else {
                // Gemini 不需要 .gemini 目录就能工作，所以这不是必须的
                debug!(
                    "[Gemini WSL] .gemini directory not found at: {:?}",
                    unc_path
                );
                None
            }
        } else {
            None
        };

        // 只要 Gemini CLI 已安装就启用 WSL 模式（.gemini 目录不是必须的）
        let enabled = gemini_path_in_wsl.is_some();

        info!(
            "[Gemini WSL] Configuration complete: enabled={}, distro={:?}",
            enabled, distro
        );

        Self {
            enabled,
            distro,
            gemini_dir_unc,
            gemini_path_in_wsl,
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn detect() -> Self {
        Self::default()
    }
}

/// 获取 Gemini WSL 运行时配置（带缓存）
pub fn get_gemini_wsl_runtime() -> &'static GeminiWslRuntime {
    GEMINI_WSL_RUNTIME.get_or_init(|| {
        let config = GeminiWslRuntime::detect();
        log::info!(
            "[Gemini WSL] Runtime initialized: enabled={}, distro={:?}, gemini_path={:?}",
            config.enabled,
            config.distro,
            config.gemini_path_in_wsl
        );
        config
    })
}

/// 获取 WSL 中 .gemini 目录的 Windows 访问路径
pub fn get_wsl_gemini_dir() -> Option<PathBuf> {
    let config = get_gemini_wsl_runtime();
    config.gemini_dir_unc.clone()
}

// ============================================================================
// WSL Claude 检测函数
// ============================================================================

/// Claude WSL 版本缓存
static CLAUDE_WSL_VERSION_CACHE: OnceLock<Option<String>> = OnceLock::new();

/// 检测 WSL 内是否安装了 Claude CLI，返回安装路径
#[cfg(target_os = "windows")]
pub fn check_wsl_claude(distro: Option<&str>) -> Option<String> {
    fn build_default_wsl_path(extra_bin: Option<&str>) -> String {
        // 保守的默认 PATH（适用于非交互 wsl -- 场景），避免依赖用户 shell 初始化（nvm/volta 等）。
        // 若 claude/node 位于某个版本管理器 bin 目录，可通过 extra_bin 注入。
        let base = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
        match extra_bin {
            Some(bin) if !bin.trim().is_empty() => format!("{}:{}", bin.trim(), base),
            _ => base.to_string(),
        }
    }

    fn maybe_program_bin_dir(program: &str) -> Option<String> {
        if !program.starts_with('/') {
            return None;
        }
        let path = std::path::Path::new(program);
        path.parent().map(|p| p.to_string_lossy().to_string())
    }

    fn verify_wsl_claude_executable(program: &str, distro: Option<&str>) -> bool {
        let mut verify_cmd = Command::new("wsl");
        if let Some(d) = distro {
            verify_cmd.arg("-d").arg(d);
        }
        verify_cmd.arg("--");

        // 若 program 是绝对路径（例如 /root/.nvm/.../bin/claude），则注入其 bin 目录到 PATH，
        // 避免脚本内部 `exec node ...` 因非交互环境 PATH 不含 node 而失败。
        if let Some(bin_dir) = maybe_program_bin_dir(program) {
            verify_cmd.arg("env");
            verify_cmd.arg(format!("PATH={}", build_default_wsl_path(Some(&bin_dir))));
            verify_cmd.arg(program);
        } else {
            verify_cmd.arg(program);
        }
        verify_cmd.arg("--version");
        verify_cmd.creation_flags(CREATE_NO_WINDOW);

        match verify_cmd.output() {
            Ok(output) if output.status.success() => true,
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                debug!(
                    "[Claude WSL] Claude candidate '{}' is not runnable (exit={:?}), stdout='{}', stderr='{}'",
                    program,
                    output.status.code(),
                    stdout,
                    stderr
                );
                false
            }
            Err(e) => {
                debug!(
                    "[Claude WSL] Failed to verify Claude candidate '{}' execution: {}",
                    program, e
                );
                false
            }
        }
    }

    // 首先尝试使用 which 命令（依赖 PATH）
    let mut cmd = Command::new("wsl");

    if let Some(d) = distro {
        cmd.arg("-d").arg(d);
    }

    cmd.args(["--", "which", "claude"]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    // 有些用户会启用 WSL 的 Windows PATH 追加（appendWindowsPath），导致 which 优先返回 /mnt/<drive>/...
    // 这通常不是我们期望的 WSL 原生 Claude（更稳定的通常是 /usr/local/bin/claude 等）。
    // 因此：若 which 返回的是 /mnt/ 路径，先作为备选，继续探测常见 Linux 路径。
    let mut fallback_from_which: Option<String> = None;

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && path.starts_with('/') {
                info!("[Claude WSL] Found claude via 'which' at: {}", path);
                // 仅以 "存在" 作为可用性会导致误判（例如脚本依赖 node，但 WSL 内无 node）
                if path.starts_with("/mnt/") {
                    if verify_wsl_claude_executable(&path, distro) {
                        fallback_from_which = Some(path);
                    }
                } else if verify_wsl_claude_executable(&path, distro) {
                    return Some(path);
                }
            }
        }
        _ => {}
    }

    // which 失败时，直接探测常见安装路径
    debug!("[Claude WSL] 'which claude' failed, trying common paths...");

    // 获取 WSL 用户的 home 目录
    let wsl_home = get_wsl_home_dir(distro).unwrap_or_else(|| "/root".to_string());

    // 常见 Claude CLI 安装路径（按优先级排序）
    let common_paths = vec![
        "/usr/local/bin/claude".to_string(),
        "/usr/bin/claude".to_string(),
        format!("{}/.local/bin/claude", wsl_home),
        format!("{}/.npm-global/bin/claude", wsl_home),
        format!("{}/.volta/bin/claude", wsl_home),
        format!("{}/.asdf/shims/claude", wsl_home),
        format!("{}/.nvm/current/bin/claude", wsl_home),
        format!("{}/.cargo/bin/claude", wsl_home),
        format!("{}/.bun/bin/claude", wsl_home),
        "/home/linuxbrew/.linuxbrew/bin/claude".to_string(),
        "/snap/bin/claude".to_string(),
    ];

    for path in &common_paths {
        // 使用 test -x 检查文件是否存在且可执行
        let mut test_cmd = Command::new("wsl");
        if let Some(d) = distro {
            test_cmd.arg("-d").arg(d);
        }
        test_cmd.args(["--", "test", "-x", path]);
        test_cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(output) = test_cmd.output() {
            if output.status.success() {
                if verify_wsl_claude_executable(path, distro) {
                    info!(
                        "[Claude WSL] Found claude via direct path check at: {}",
                        path
                    );
                    return Some(path.clone());
                }
            }
        }
    }

    // 尝试扫描 nvm 安装的 Node.js 版本
    let nvm_versions_dir = format!("{}/.nvm/versions/node", wsl_home);
    let mut ls_cmd = Command::new("wsl");
    if let Some(d) = distro {
        ls_cmd.arg("-d").arg(d);
    }
    ls_cmd.args(["--", "ls", "-1", &nvm_versions_dir]);
    ls_cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = ls_cmd.output() {
        if output.status.success() {
            let versions = String::from_utf8_lossy(&output.stdout);
            for version in versions.lines() {
                let version = version.trim();
                if !version.is_empty() {
                    let claude_path = format!("{}/{}/bin/claude", nvm_versions_dir, version);
                    let mut test_cmd = Command::new("wsl");
                    if let Some(d) = distro {
                        test_cmd.arg("-d").arg(d);
                    }
                    test_cmd.args(["--", "test", "-x", &claude_path]);
                    test_cmd.creation_flags(CREATE_NO_WINDOW);

                    if let Ok(test_output) = test_cmd.output() {
                        if test_output.status.success() {
                            if verify_wsl_claude_executable(&claude_path, distro) {
                                info!(
                                    "[Claude WSL] Found claude in nvm version {} at: {}",
                                    version, claude_path
                                );
                                return Some(claude_path);
                            }
                        }
                    }
                }
            }
        }
    }

    debug!("[Claude WSL] Claude not found in any common paths");
    fallback_from_which
}

#[cfg(not(target_os = "windows"))]
pub fn check_wsl_claude(_distro: Option<&str>) -> Option<String> {
    None
}

/// 获取 WSL 内 Claude CLI 的版本（带缓存）
#[cfg(target_os = "windows")]
pub fn get_wsl_claude_version(distro: Option<&str>) -> Option<String> {
    // 使用缓存避免频繁创建 WSL 进程
    CLAUDE_WSL_VERSION_CACHE
        .get_or_init(|| {
            debug!("[Claude WSL] Fetching Claude version (first time)...");
            fetch_wsl_claude_version(distro)
        })
        .clone()
}

/// 实际获取 WSL 内 Claude CLI 的版本（内部函数）
#[cfg(target_os = "windows")]
fn fetch_wsl_claude_version(distro: Option<&str>) -> Option<String> {
    let mut cmd = Command::new("wsl");

    if let Some(d) = distro {
        cmd.arg("-d").arg(d);
    }

    // 优先使用探测到的绝对路径，避免非交互环境 PATH 不包含 nvm/volta 等安装目录
    let program = check_wsl_claude(distro).unwrap_or_else(|| "claude".to_string());
    cmd.arg("--");
    if let Some(path_env) = build_wsl_path_for_program(&program) {
        cmd.arg("env");
        cmd.arg(format!("PATH={}", path_env));
        cmd.arg(&program);
    } else {
        cmd.arg(&program);
    }
    cmd.arg("--version");
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                debug!("[Claude WSL] Claude version: {}", version);
                Some(version)
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_wsl_claude_version(_distro: Option<&str>) -> Option<String> {
    None
}

/// Claude WSL 运行时配置结构
#[derive(Debug, Clone, Default)]
pub struct ClaudeWslRuntime {
    /// 是否启用 WSL 模式
    pub enabled: bool,
    /// WSL 发行版名称（如 "Debian", "Ubuntu"）
    pub distro: Option<String>,
    /// .claude 目录的 Windows UNC 路径
    pub claude_dir_unc: Option<PathBuf>,
    /// WSL 内 Claude CLI 的路径（如 "/usr/local/bin/claude"）
    pub claude_path_in_wsl: Option<String>,
}

/// 全局 Claude WSL 运行时配置缓存
static CLAUDE_WSL_RUNTIME: OnceLock<ClaudeWslRuntime> = OnceLock::new();

impl ClaudeWslRuntime {
    /// 自动检测并创建 Claude WSL 配置
    ///
    /// 检测策略（根据用户配置）：
    /// - Auto（默认）：原生优先，WSL 作为后备
    /// - Native：强制使用原生，不启用 WSL
    /// - Wsl：强制使用 WSL（如果可用）
    #[cfg(target_os = "windows")]
    pub fn detect() -> Self {
        let claude_config = get_claude_wsl_config();
        info!(
            "[Claude WSL] Detecting Claude configuration (mode: {:?})...",
            claude_config.mode
        );

        match claude_config.mode {
            ClaudeMode::Native => {
                // 强制原生模式，不启用 WSL
                info!("[Claude WSL] Mode set to Native, WSL disabled");
                return Self::default();
            }
            ClaudeMode::Wsl => {
                // 强制 WSL 模式
                info!("[Claude WSL] Mode set to WSL, attempting to use WSL Claude...");
                return Self::detect_wsl_config(claude_config.wsl_distro.as_deref());
            }
            ClaudeMode::Auto => {
                // 自动模式：原生优先
                if is_native_claude_available() {
                    info!("[Claude WSL] Native Windows Claude is available, WSL mode disabled");
                    return Self::default();
                }
                info!("[Claude WSL] Native Claude not found, checking WSL as fallback...");
                return Self::detect_wsl_config(claude_config.wsl_distro.as_deref());
            }
        }
    }

    /// 检测 WSL 配置（内部方法）
    #[cfg(target_os = "windows")]
    fn detect_wsl_config(preferred_distro: Option<&str>) -> Self {
        if !is_wsl_available() {
            info!("[Claude WSL] WSL is not available");
            return Self::default();
        }

        // 使用用户指定的发行版或默认发行版
        let distro = if let Some(d) = preferred_distro {
            // 验证用户指定的发行版是否存在
            let distros = get_wsl_distros();
            if distros.iter().any(|name| name == d) {
                info!("[Claude WSL] Using user-specified distro: {}", d);
                Some(d.to_string())
            } else {
                warn!(
                    "[Claude WSL] User-specified distro '{}' not found, using default",
                    d
                );
                get_default_wsl_distro()
            }
        } else {
            get_default_wsl_distro()
        };

        if distro.is_none() {
            info!("[Claude WSL] No WSL distro found");
            return Self::default();
        }

        let Some(distro_name) = distro.as_deref() else {
            info!("[Claude WSL] No WSL distro found");
            return Self::default();
        };
        info!("[Claude WSL] Found WSL distro: {}", distro_name);

        let wsl_home = get_wsl_home_dir(Some(distro_name));
        info!("[Claude WSL] WSL home directory: {:?}", wsl_home);

        let claude_path_in_wsl = check_wsl_claude(Some(distro_name));
        info!("[Claude WSL] Claude path in WSL: {:?}", claude_path_in_wsl);

        // .claude 目录可能尚未创建（首次运行 Claude），这里不以 exists() 作为启用条件。
        // 直接构建 UNC 路径，后续读写会话时可按需创建目录。
        let wsl_home_for_claude = wsl_home.as_deref().unwrap_or("/root");
        let claude_dir_unc = Some(build_wsl_unc_path(
            &format!("{}/.claude", wsl_home_for_claude),
            distro_name,
        ));

        // 只要 Claude CLI 已安装就启用 WSL 模式（会话目录可延迟创建）
        let enabled = claude_path_in_wsl.is_some();

        info!(
            "[Claude WSL] Configuration complete: enabled={}, distro={:?}",
            enabled, distro
        );

        Self {
            enabled,
            distro,
            claude_dir_unc,
            claude_path_in_wsl,
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn detect() -> Self {
        Self::default()
    }
}

/// 获取 Claude WSL 运行时配置（带缓存）
pub fn get_claude_wsl_runtime() -> &'static ClaudeWslRuntime {
    CLAUDE_WSL_RUNTIME.get_or_init(|| {
        let config = ClaudeWslRuntime::detect();
        log::info!(
            "[Claude WSL] Runtime initialized: enabled={}, distro={:?}, claude_path={:?}",
            config.enabled,
            config.distro,
            config.claude_path_in_wsl
        );
        config
    })
}

/// 获取 WSL 中 .claude 目录的 Windows 访问路径
pub fn get_wsl_claude_dir() -> Option<PathBuf> {
    let config = get_claude_wsl_runtime();
    config.claude_dir_unc.clone()
}
