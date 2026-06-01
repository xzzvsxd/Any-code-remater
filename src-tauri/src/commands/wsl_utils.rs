//! WSL (Windows Subsystem for Linux) 兼容性工具
//!
//! 提供 Windows 主机与 WSL 环境之间的路径转换和命令执行支持
//! 支持 Windows + WSL Codex/Gemini 场景

#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;

#[cfg(target_os = "windows")]
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
use log::{debug, info, warn};

#[cfg(target_os = "windows")]
use crate::claude_binary::detect_binary_for_tool;

pub use super::wsl_runtime::*;

// Windows CREATE_NO_WINDOW 标志
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub struct WslCommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
    pub distro: Option<String>,
    pub marker: Option<String>,
}

impl WslCommandSpec {
    /// Long-running AI sessions must be launched with a per-run marker before
    /// they can be terminated safely.  Name/argument based kills are too broad
    /// for concurrent Codex/Gemini/Claude sessions that often share the same
    /// command line.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub fn is_marked(&self) -> bool {
        self.marker
            .as_deref()
            .map(|marker| !marker.trim().is_empty())
            .unwrap_or(false)
    }
}

// ============================================================================
// Codex 模式配置
// ============================================================================

/// Codex 执行模式偏好
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum CodexMode {
    /// 自动检测（默认）：原生优先，WSL 作为后备
    #[default]
    Auto,
    /// 强制使用 Windows 原生 Codex
    Native,
    /// 强制使用 WSL Codex
    Wsl,
}

/// Codex 配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfig {
    /// Codex 执行模式偏好
    #[serde(default)]
    pub mode: CodexMode,
    /// WSL 发行版名称（可选，留空则使用默认）
    pub wsl_distro: Option<String>,
}

impl Default for CodexConfig {
    fn default() -> Self {
        Self {
            mode: CodexMode::Auto,
            wsl_distro: None,
        }
    }
}

/// 全局 Codex 配置缓存
static CODEX_CONFIG: OnceLock<CodexConfig> = OnceLock::new();

/// 获取 Codex 配置（带缓存）
pub fn get_codex_config() -> &'static CodexConfig {
    CODEX_CONFIG.get_or_init(|| load_codex_config().unwrap_or_default())
}

/// 从配置文件加载 Codex 配置
fn load_codex_config() -> Option<CodexConfig> {
    let home_dir = dirs::home_dir()?;
    let config_file = home_dir.join(".codex").join("workbench_config.json");

    if !config_file.exists() {
        log::debug!("[Codex Config] Config file not found: {:?}", config_file);
        return None;
    }

    match std::fs::read_to_string(&config_file) {
        Ok(content) => match serde_json::from_str::<CodexConfig>(&content) {
            Ok(config) => {
                log::info!(
                    "[Codex Config] Loaded config: mode={:?}, wsl_distro={:?}",
                    config.mode,
                    config.wsl_distro
                );
                Some(config)
            }
            Err(e) => {
                log::warn!("[Codex Config] Failed to parse config: {}", e);
                None
            }
        },
        Err(e) => {
            log::warn!("[Codex Config] Failed to read config file: {}", e);
            None
        }
    }
}

/// 保存 Codex 配置到文件
pub fn save_codex_config(config: &CodexConfig) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    let codex_dir = home_dir.join(".codex");
    if !codex_dir.exists() {
        std::fs::create_dir_all(&codex_dir)
            .map_err(|e| format!("Failed to create .codex directory: {}", e))?;
    }

    let config_file = codex_dir.join("workbench_config.json");
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("[Codex Config] Saved config to {:?}", config_file);
    Ok(())
}

// ============================================================================
// Claude 模式配置
// ============================================================================

/// Claude 执行模式偏好
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ClaudeMode {
    /// 自动检测（默认）：原生优先，WSL 作为后备
    #[default]
    Auto,
    /// 强制使用 Windows 原生 Claude
    Native,
    /// 强制使用 WSL Claude
    Wsl,
}

/// Claude WSL 配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeWslConfig {
    /// Claude 执行模式偏好
    #[serde(default)]
    pub mode: ClaudeMode,
    /// WSL 发行版名称（可选，留空则使用默认）
    pub wsl_distro: Option<String>,
}

impl Default for ClaudeWslConfig {
    fn default() -> Self {
        Self {
            mode: ClaudeMode::Auto,
            wsl_distro: None,
        }
    }
}

/// 全局 Claude WSL 配置缓存
static CLAUDE_WSL_CONFIG: OnceLock<ClaudeWslConfig> = OnceLock::new();

/// 获取 Claude WSL 配置（带缓存）
pub fn get_claude_wsl_config() -> &'static ClaudeWslConfig {
    CLAUDE_WSL_CONFIG.get_or_init(|| load_claude_wsl_config().unwrap_or_default())
}

/// 从配置文件加载 Claude WSL 配置
fn load_claude_wsl_config() -> Option<ClaudeWslConfig> {
    let home_dir = dirs::home_dir()?;
    let config_file = home_dir.join(".claude").join("workbench_config.json");

    if !config_file.exists() {
        log::debug!(
            "[Claude WSL Config] Config file not found: {:?}",
            config_file
        );
        return None;
    }

    match std::fs::read_to_string(&config_file) {
        Ok(content) => match serde_json::from_str::<ClaudeWslConfig>(&content) {
            Ok(config) => {
                log::info!(
                    "[Claude WSL Config] Loaded config: mode={:?}, wsl_distro={:?}",
                    config.mode,
                    config.wsl_distro
                );
                Some(config)
            }
            Err(e) => {
                log::warn!("[Claude WSL Config] Failed to parse config: {}", e);
                None
            }
        },
        Err(e) => {
            log::warn!("[Claude WSL Config] Failed to read config file: {}", e);
            None
        }
    }
}

/// 保存 Claude WSL 配置到文件
pub fn save_claude_wsl_config(config: &ClaudeWslConfig) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    let claude_dir = home_dir.join(".claude");
    if !claude_dir.exists() {
        std::fs::create_dir_all(&claude_dir)
            .map_err(|e| format!("Failed to create .claude directory: {}", e))?;
    }

    let config_file = claude_dir.join("workbench_config.json");
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("[Claude WSL Config] Saved config to {:?}", config_file);
    Ok(())
}

// ============================================================================
// Gemini 模式配置
// ============================================================================

/// Gemini 执行模式偏好
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum GeminiMode {
    /// 自动检测（默认）：原生优先，WSL 作为后备
    #[default]
    Auto,
    /// 强制使用 Windows 原生 Gemini
    Native,
    /// 强制使用 WSL Gemini
    Wsl,
}

/// Gemini WSL 配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiWslConfig {
    /// Gemini 执行模式偏好
    #[serde(default)]
    pub mode: GeminiMode,
    /// WSL 发行版名称（可选，留空则使用默认）
    pub wsl_distro: Option<String>,
}

impl Default for GeminiWslConfig {
    fn default() -> Self {
        Self {
            mode: GeminiMode::Auto,
            wsl_distro: None,
        }
    }
}

/// 全局 Gemini WSL 配置缓存
static GEMINI_WSL_CONFIG: OnceLock<GeminiWslConfig> = OnceLock::new();

/// 获取 Gemini WSL 配置（带缓存）
pub fn get_gemini_wsl_config() -> &'static GeminiWslConfig {
    GEMINI_WSL_CONFIG.get_or_init(|| load_gemini_wsl_config().unwrap_or_default())
}

/// 从配置文件加载 Gemini WSL 配置
fn load_gemini_wsl_config() -> Option<GeminiWslConfig> {
    let home_dir = dirs::home_dir()?;
    let config_file = home_dir.join(".gemini").join("workbench_config.json");

    if !config_file.exists() {
        log::debug!(
            "[Gemini WSL Config] Config file not found: {:?}",
            config_file
        );
        return None;
    }

    match std::fs::read_to_string(&config_file) {
        Ok(content) => match serde_json::from_str::<GeminiWslConfig>(&content) {
            Ok(config) => {
                log::info!(
                    "[Gemini WSL Config] Loaded config: mode={:?}, wsl_distro={:?}",
                    config.mode,
                    config.wsl_distro
                );
                Some(config)
            }
            Err(e) => {
                log::warn!("[Gemini WSL Config] Failed to parse config: {}", e);
                None
            }
        },
        Err(e) => {
            log::warn!("[Gemini WSL Config] Failed to read config file: {}", e);
            None
        }
    }
}

/// 保存 Gemini WSL 配置到文件
pub fn save_gemini_wsl_config(config: &GeminiWslConfig) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    let gemini_dir = home_dir.join(".gemini");
    if !gemini_dir.exists() {
        std::fs::create_dir_all(&gemini_dir)
            .map_err(|e| format!("Failed to create .gemini directory: {}", e))?;
    }

    let config_file = gemini_dir.join("workbench_config.json");
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("[Gemini WSL Config] Saved config to {:?}", config_file);
    Ok(())
}

// ============================================================================
// WSL 配置结构
// ============================================================================

/// WSL 配置结构
#[derive(Debug, Clone, Default)]
pub struct WslConfig {
    /// 是否启用 WSL 模式
    pub enabled: bool,
    /// WSL 发行版名称（如 "Debian", "Ubuntu"）
    pub distro: Option<String>,
    /// .codex 目录的 Windows UNC 路径
    pub codex_dir_unc: Option<PathBuf>,
    /// WSL 内 Codex 的路径（如 "/usr/local/bin/codex"）
    pub codex_path_in_wsl: Option<String>,
}

/// 全局 WSL 配置缓存
static WSL_CONFIG: OnceLock<WslConfig> = OnceLock::new();

/// Codex WSL 版本缓存
static CODEX_WSL_VERSION_CACHE: OnceLock<Option<String>> = OnceLock::new();

impl WslConfig {
    /// 自动检测并创建 WSL 配置
    ///
    /// 检测策略（根据用户配置）：
    /// - Auto（默认）：原生优先，WSL 作为后备
    /// - Native：强制使用原生，不启用 WSL
    /// - Wsl：强制使用 WSL（如果可用）
    #[cfg(target_os = "windows")]
    pub fn detect() -> Self {
        let codex_config = get_codex_config();
        info!(
            "[WSL] Detecting Codex configuration (mode: {:?})...",
            codex_config.mode
        );

        match codex_config.mode {
            CodexMode::Native => {
                // 强制原生模式，不启用 WSL
                info!("[WSL] Mode set to Native, WSL disabled");
                return Self::default();
            }
            CodexMode::Wsl => {
                // 强制 WSL 模式
                info!("[WSL] Mode set to WSL, attempting to use WSL Codex...");
                return Self::detect_wsl_config(codex_config.wsl_distro.as_deref());
            }
            CodexMode::Auto => {
                // 自动模式：原生优先
                if is_native_codex_available() {
                    info!("[WSL] Native Windows Codex is available, WSL mode disabled");
                    return Self::default();
                }
                info!("[WSL] Native Codex not found, checking WSL as fallback...");
                return Self::detect_wsl_config(codex_config.wsl_distro.as_deref());
            }
        }
    }

    /// 检测 WSL 配置（内部方法）
    #[cfg(target_os = "windows")]
    fn detect_wsl_config(preferred_distro: Option<&str>) -> Self {
        if !is_wsl_available() {
            info!("[WSL] WSL is not available");
            return Self::default();
        }

        // 使用用户指定的发行版或默认发行版
        let distro = if let Some(d) = preferred_distro {
            // 验证用户指定的发行版是否存在
            let distros = get_wsl_distros();
            if distros.iter().any(|name| name == d) {
                info!("[WSL] Using user-specified distro: {}", d);
                Some(d.to_string())
            } else {
                warn!(
                    "[WSL] User-specified distro '{}' not found, using default",
                    d
                );
                get_default_wsl_distro()
            }
        } else {
            get_default_wsl_distro()
        };

        if distro.is_none() {
            info!("[WSL] No WSL distro found");
            return Self::default();
        }

        let Some(distro_name) = distro.as_deref() else {
            info!("[WSL] No WSL distro found");
            return Self::default();
        };
        info!("[WSL] Found WSL distro: {}", distro_name);

        let wsl_home = get_wsl_home_dir(Some(distro_name));
        info!("[WSL] WSL home directory: {:?}", wsl_home);

        let codex_path_in_wsl = check_wsl_codex(Some(distro_name));
        info!("[WSL] Codex path in WSL: {:?}", codex_path_in_wsl);

        // .codex 目录可能尚未创建（首次运行 Codex），这里不以 exists() 作为启用条件。
        // 直接构建 UNC 路径，后续读写会话时可按需创建目录。
        let wsl_home_for_codex = wsl_home.as_deref().unwrap_or("/root");
        let codex_dir_unc = Some(build_wsl_unc_path(
            &format!("{}/.codex", wsl_home_for_codex),
            distro_name,
        ));

        // 只要 Codex CLI 已安装就启用 WSL 模式（会话目录可延迟创建）
        let enabled = codex_path_in_wsl.is_some();

        info!(
            "[WSL] Configuration complete: enabled={}, distro={:?}",
            enabled, distro
        );

        Self {
            enabled,
            distro,
            codex_dir_unc,
            codex_path_in_wsl,
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn detect() -> Self {
        Self::default()
    }
}

/// 获取 WSL 配置（带缓存）
pub fn get_wsl_config() -> &'static WslConfig {
    WSL_CONFIG.get_or_init(|| {
        let config = WslConfig::detect();
        log::info!(
            "[WSL] Config initialized: enabled={}, distro={:?}, codex_path={:?}",
            config.enabled,
            config.distro,
            config.codex_path_in_wsl
        );
        config
    })
}

/// 重置 WSL 配置缓存（用于测试或重新检测）
#[allow(dead_code)]
pub fn reset_wsl_config() {
    // OnceLock 不支持 reset，需要重启应用
    log::warn!("[WSL] Config reset requires application restart");
}

// ============================================================================
// Windows 原生 Codex 检测
// ============================================================================

/// 检测 Windows 原生 Codex 是否可用
#[cfg(target_os = "windows")]
pub fn is_native_codex_available() -> bool {
    // 与其他模块保持一致：统一使用 detect_binary_for_tool 作为原生可用性判断依据
    // 覆盖 env、PATH、注册表、常见目录以及用户配置（binaries.json）。
    let (_env, detected) = detect_binary_for_tool("codex", "CODEX_PATH", "codex");
    let available = detected.is_some();
    debug!(
        "[WSL] Native Codex available (unified detection): {}",
        available
    );
    available
}

#[cfg(not(target_os = "windows"))]
pub fn is_native_codex_available() -> bool {
    // 非 Windows 平台总是返回 true（不需要 WSL）
    true
}

// ============================================================================
// Windows 原生 Gemini 检测
// ============================================================================

/// 检测 Windows 原生 Gemini CLI 是否可用
#[cfg(target_os = "windows")]
pub fn is_native_gemini_available() -> bool {
    // 检查常见的 Gemini 安装路径
    let paths_to_try = get_native_gemini_paths();

    for path in &paths_to_try {
        if std::path::Path::new(path).exists() {
            debug!("[Gemini WSL] Found native Gemini at: {}", path);
            return true;
        }
    }

    // 尝试运行 gemini --version 看是否在 PATH 中
    let mut cmd = Command::new("gemini");
    cmd.arg("--version");
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(output) if output.status.success() => {
            debug!("[Gemini WSL] Native Gemini found in PATH");
            true
        }
        _ => {
            debug!("[Gemini WSL] Native Gemini not found");
            false
        }
    }
}

/// 获取 Windows 原生 Gemini CLI 可能的安装路径
#[cfg(target_os = "windows")]
fn get_native_gemini_paths() -> Vec<String> {
    let mut paths = Vec::new();

    // 检测 npm 配置的自定义 prefix（nvm-windows 全局路径）
    if let Ok(npm_prefix) = std::env::var("npm_config_prefix") {
        paths.push(format!(r"{}\gemini.cmd", npm_prefix));
        paths.push(format!(r"{}\gemini", npm_prefix));
        paths.push(format!(r"{}\bin\gemini.cmd", npm_prefix));
        paths.push(format!(r"{}\bin\gemini", npm_prefix));
        debug!("[Gemini WSL] Checking npm_config_prefix: {}", npm_prefix);
    }

    // 检测 NVM_HOME 环境变量（nvm-windows 安装目录）
    if let Ok(nvm_home) = std::env::var("NVM_HOME") {
        // nvm-windows 的 node_global 目录（自定义全局路径）
        paths.push(format!(r"{}\node_global\gemini.cmd", nvm_home));
        paths.push(format!(r"{}\node_global\gemini", nvm_home));
        debug!("[Gemini WSL] Checking NVM_HOME: {}", nvm_home);
    }

    // 检测 NVM_SYMLINK 环境变量（当前激活的 Node.js 版本）
    if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
        paths.push(format!(r"{}\gemini.cmd", nvm_symlink));
        paths.push(format!(r"{}\gemini", nvm_symlink));
        paths.push(format!(r"{}\node_modules\.bin\gemini.cmd", nvm_symlink));
        debug!("[Gemini WSL] Checking NVM_SYMLINK: {}", nvm_symlink);
    }

    // 常见的 nvm-windows 全局路径模式
    if let Ok(programfiles) = std::env::var("ProgramFiles") {
        paths.push(format!(r"{}\nvm\node_global\gemini.cmd", programfiles));
        paths.push(format!(r"{}\nvm\node_global\gemini", programfiles));
    }

    // npm 全局安装路径 (APPDATA - 标准位置)
    if let Ok(appdata) = std::env::var("APPDATA") {
        paths.push(format!(r"{}\npm\gemini.cmd", appdata));
        paths.push(format!(r"{}\npm\gemini", appdata));
        // nvm-windows 安装的 Node.js 版本
        let nvm_dir = format!(r"{}\nvm", appdata);
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let gemini_path = entry.path().join("gemini.cmd");
                    if gemini_path.exists() {
                        paths.push(gemini_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    // npm 全局安装路径 (LOCALAPPDATA - 某些配置下的位置)
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        paths.push(format!(r"{}\npm\gemini.cmd", localappdata));
        paths.push(format!(r"{}\npm\gemini", localappdata));
        // pnpm 全局安装路径
        paths.push(format!(r"{}\pnpm\gemini.cmd", localappdata));
        paths.push(format!(r"{}\pnpm\gemini", localappdata));
        // Yarn 全局安装路径
        paths.push(format!(r"{}\Yarn\bin\gemini.cmd", localappdata));
        paths.push(format!(r"{}\Yarn\bin\gemini", localappdata));
    }

    // 用户目录下的安装路径
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        // 自定义 npm 全局目录
        paths.push(format!(r"{}\.npm-global\bin\gemini.cmd", userprofile));
        paths.push(format!(r"{}\.npm-global\bin\gemini", userprofile));
        paths.push(format!(r"{}\.npm-global\gemini.cmd", userprofile));
        // Volta 安装路径
        paths.push(format!(r"{}\.volta\bin\gemini.cmd", userprofile));
        paths.push(format!(r"{}\.volta\bin\gemini", userprofile));
        // fnm (Fast Node Manager) 安装路径
        paths.push(format!(r"{}\.fnm\aliases\default\gemini.cmd", userprofile));
        // Scoop 安装路径
        paths.push(format!(r"{}\scoop\shims\gemini.cmd", userprofile));
        paths.push(format!(
            r"{}\scoop\apps\nodejs\current\gemini.cmd",
            userprofile
        ));
        // 本地 bin 目录
        paths.push(format!(r"{}\.local\bin\gemini.cmd", userprofile));
        paths.push(format!(r"{}\.local\bin\gemini", userprofile));
    }

    // Node.js 安装路径
    if let Ok(programfiles) = std::env::var("ProgramFiles") {
        paths.push(format!(r"{}\nodejs\gemini.cmd", programfiles));
        paths.push(format!(r"{}\nodejs\gemini", programfiles));
    }

    // Chocolatey 安装路径
    if let Ok(programdata) = std::env::var("ProgramData") {
        paths.push(format!(r"{}\chocolatey\bin\gemini.cmd", programdata));
        paths.push(format!(r"{}\chocolatey\bin\gemini", programdata));
    }

    // Homebrew (通过 WSL 或 Git Bash)
    paths.push(r"C:\Homebrew\bin\gemini".to_string());

    paths
}

#[cfg(not(target_os = "windows"))]
pub fn is_native_gemini_available() -> bool {
    // 非 Windows 平台总是返回 true（不需要 WSL）
    true
}

// ============================================================================
// Windows 原生 Claude 检测
// ============================================================================

/// 检测 Windows 原生 Claude CLI 是否可用
#[cfg(target_os = "windows")]
pub fn is_native_claude_available() -> bool {
    // 与其他模块保持一致：统一使用 detect_binary_for_tool 作为原生可用性判断依据
    // 覆盖 env、PATH、注册表、常见目录以及用户配置（binaries.json）。
    let (_env, detected) = detect_binary_for_tool("claude", "CLAUDE_PATH", "claude");
    let available = detected.is_some();
    debug!(
        "[Claude WSL] Native Claude available (unified detection): {}",
        available
    );
    available
}

#[cfg(not(target_os = "windows"))]
pub fn is_native_claude_available() -> bool {
    // 非 Windows 平台总是返回 true（不需要 WSL）
    true
}

// ============================================================================
// WSL 检测函数
// ============================================================================

/// 检测 WSL 是否可用
#[cfg(target_os = "windows")]
pub fn is_wsl_available() -> bool {
    let mut cmd = Command::new("wsl");
    cmd.arg("--status");
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(output) => {
            let available = output.status.success();
            debug!("[WSL] WSL available: {}", available);
            available
        }
        Err(e) => {
            debug!("[WSL] WSL check failed: {}", e);
            false
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn is_wsl_available() -> bool {
    false
}

/// 获取可用的 WSL 发行版列表
#[cfg(target_os = "windows")]
pub fn get_wsl_distros() -> Vec<String> {
    let mut cmd = Command::new("wsl");
    cmd.args(["--list", "--quiet"]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(output) if output.status.success() => {
            // WSL 输出是 UTF-16 LE 编码
            let raw = output.stdout;
            let decoded = String::from_utf16_lossy(
                &raw.chunks(2)
                    .filter_map(|c| {
                        if c.len() == 2 {
                            Some(u16::from_le_bytes([c[0], c[1]]))
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<u16>>(),
            );

            let distros: Vec<String> = decoded
                .lines()
                .map(|s| s.trim().trim_matches('\0').to_string())
                .filter(|s| !s.is_empty())
                .collect();

            debug!("[WSL] Found distros: {:?}", distros);
            distros
        }
        _ => vec![],
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_wsl_distros() -> Vec<String> {
    vec![]
}

/// 获取默认 WSL 发行版名称
pub fn get_default_wsl_distro() -> Option<String> {
    get_wsl_distros().into_iter().next()
}

/// 获取 WSL 用户的 home 目录（在 WSL 内的路径）
/// 返回如 "/root" 或 "/home/username"
#[cfg(target_os = "windows")]
pub fn get_wsl_home_dir(distro: Option<&str>) -> Option<String> {
    let mut cmd = Command::new("wsl");

    if let Some(d) = distro {
        cmd.arg("-d").arg(d);
    }

    // 必须通过 shell 才能展开 $HOME；直接执行 `echo "$HOME"` 会输出字面量 "$HOME"
    cmd.args(["--", "bash", "-lc", "echo $HOME"]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !home.is_empty() && home.starts_with('/') {
                debug!("[WSL] Home directory: {}", home);
                Some(home)
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_wsl_home_dir(_distro: Option<&str>) -> Option<String> {
    None
}

/// 检测 WSL 内是否安装了 Codex，返回安装路径
#[cfg(target_os = "windows")]
pub fn check_wsl_codex(distro: Option<&str>) -> Option<String> {
    fn build_default_wsl_path(extra_bin: Option<&str>) -> String {
        // 保守的默认 PATH（适用于非交互 wsl -- 场景），避免依赖用户 shell 初始化（nvm/volta 等）。
        // 若 codex/node 位于某个版本管理器 bin 目录，可通过 extra_bin 注入。
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

    fn verify_wsl_codex_executable(program: &str, distro: Option<&str>) -> bool {
        let mut verify_cmd = Command::new("wsl");
        if let Some(d) = distro {
            verify_cmd.arg("-d").arg(d);
        }
        verify_cmd.arg("--");

        // 若 program 是绝对路径（例如 /root/.nvm/.../bin/codex），则注入其 bin 目录到 PATH，
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
                    "[WSL] Codex candidate '{}' is not runnable (exit={:?}), stdout='{}', stderr='{}'",
                    program,
                    output.status.code(),
                    stdout,
                    stderr
                );
                false
            }
            Err(e) => {
                debug!(
                    "[WSL] Failed to verify Codex candidate '{}' execution: {}",
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

    cmd.args(["--", "which", "codex"]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    // 有些用户会启用 WSL 的 Windows PATH 追加（appendWindowsPath），导致 which 优先返回 /mnt/<drive>/...
    // 这通常不是我们期望的 WSL 原生 Codex（更稳定的通常是 /usr/local/bin/codex 等）。
    // 因此：若 which 返回的是 /mnt/ 路径，先作为备选，继续探测常见 Linux 路径。
    let mut fallback_from_which: Option<String> = None;

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && path.starts_with('/') {
                info!("[WSL] Found codex via 'which' at: {}", path);
                // 仅以 "存在" 作为可用性会导致误判（例如脚本依赖 node，但 WSL 内无 node）
                if path.starts_with("/mnt/") {
                    if verify_wsl_codex_executable(&path, distro) {
                        fallback_from_which = Some(path);
                    }
                } else if verify_wsl_codex_executable(&path, distro) {
                    return Some(path);
                }
            }
        }
        _ => {}
    }

    // which 失败时，直接探测常见安装路径
    debug!("[WSL] 'which codex' failed, trying common paths...");

    // 获取 WSL 用户的 home 目录
    let wsl_home = get_wsl_home_dir(distro).unwrap_or_else(|| "/root".to_string());

    // 常见 Codex 安装路径（按优先级排序）
    let common_paths = vec![
        "/usr/local/bin/codex".to_string(),
        "/usr/bin/codex".to_string(),
        format!("{}/.local/bin/codex", wsl_home),
        format!("{}/.npm-global/bin/codex", wsl_home),
        format!("{}/.volta/bin/codex", wsl_home),
        format!("{}/.asdf/shims/codex", wsl_home),
        format!("{}/.nvm/current/bin/codex", wsl_home),
        format!("{}/.cargo/bin/codex", wsl_home),
        format!("{}/.bun/bin/codex", wsl_home),
        "/home/linuxbrew/.linuxbrew/bin/codex".to_string(),
        "/snap/bin/codex".to_string(),
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
                if verify_wsl_codex_executable(path, distro) {
                    info!("[WSL] Found codex via direct path check at: {}", path);
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
                    let codex_path = format!("{}/{}/bin/codex", nvm_versions_dir, version);
                    let mut test_cmd = Command::new("wsl");
                    if let Some(d) = distro {
                        test_cmd.arg("-d").arg(d);
                    }
                    test_cmd.args(["--", "test", "-x", &codex_path]);
                    test_cmd.creation_flags(CREATE_NO_WINDOW);

                    if let Ok(test_output) = test_cmd.output() {
                        if test_output.status.success() {
                            if verify_wsl_codex_executable(&codex_path, distro) {
                                info!(
                                    "[WSL] Found codex in nvm version {} at: {}",
                                    version, codex_path
                                );
                                return Some(codex_path);
                            }
                        }
                    }
                }
            }
        }
    }

    debug!("[WSL] Codex not found in any common paths");
    fallback_from_which
}

/// 为 WSL 非交互执行构建 PATH：默认系统路径 + （可选）program 所在 bin 目录。
///
/// 典型场景：Codex 安装在 nvm/fnm 的版本 bin 目录下，但非交互 wsl -- 不会加载 shell 初始化，导致 node 不在 PATH。
#[cfg(target_os = "windows")]
pub fn build_wsl_path_for_program(program: &str) -> Option<String> {
    if !program.starts_with('/') {
        return None;
    }
    let bin_dir = std::path::Path::new(program)
        .parent()
        .map(|p| p.to_string_lossy().to_string())?;
    let base = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    Some(format!("{}:{}", bin_dir.trim(), base))
}

#[cfg(not(target_os = "windows"))]
pub fn check_wsl_codex(_distro: Option<&str>) -> Option<String> {
    None
}

/// 获取 WSL 内 Codex 的版本（带缓存）
#[cfg(target_os = "windows")]
pub fn get_wsl_codex_version(distro: Option<&str>) -> Option<String> {
    // 使用缓存避免频繁创建 WSL 进程
    CODEX_WSL_VERSION_CACHE
        .get_or_init(|| {
            debug!("[WSL] Fetching Codex version (first time)...");
            fetch_wsl_codex_version(distro)
        })
        .clone()
}

/// 实际获取 WSL 内 Codex 的版本（内部函数）
#[cfg(target_os = "windows")]
fn fetch_wsl_codex_version(distro: Option<&str>) -> Option<String> {
    let mut cmd = Command::new("wsl");

    if let Some(d) = distro {
        cmd.arg("-d").arg(d);
    }

    // 优先使用探测到的绝对路径，避免非交互环境 PATH 不包含 nvm/volta 等安装目录
    let program = check_wsl_codex(distro).unwrap_or_else(|| "codex".to_string());
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
                debug!("[WSL] Codex version: {}", version);
                Some(version)
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_wsl_codex_version(_distro: Option<&str>) -> Option<String> {
    None
}

// ============================================================================
// WSL Gemini 检测函数
// ============================================================================

/// 解析 WSL UNC 路径（例如 `\\wsl.localhost\Ubuntu\home\user`）。
fn try_parse_wsl_unc_path(windows_path: &str) -> Option<(String, String)> {
    let raw = windows_path.trim();
    if !(raw.starts_with("\\\\") || raw.starts_with("//")) {
        return None;
    }

    // 统一为反斜杠，便于解析
    let normalized = raw.replace('/', "\\");

    let mut parts = normalized
        .trim_start_matches("\\\\")
        .split('\\')
        .filter(|s| !s.is_empty());

    let host = parts.next()?.to_lowercase();
    if host != "wsl.localhost" && host != "wsl$" && host != "wsl" {
        return None;
    }

    let distro = parts.next()?.to_string();
    let rest: Vec<&str> = parts.collect();
    let wsl_path = if rest.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", rest.join("/"))
    };

    Some((distro, wsl_path))
}

/// 将 Windows 路径转换为 WSL 路径
///
/// # Examples
/// ```
/// assert_eq!(windows_to_wsl_path("C:\\Users\\test"), "/mnt/c/Users/test");
/// assert_eq!(windows_to_wsl_path("D:\\Projects"), "/mnt/d/Projects");
/// ```
pub fn windows_to_wsl_path(windows_path: &str) -> String {
    // 处理 WSL UNC 路径（支持）
    if let Some((_distro, wsl_path)) = try_parse_wsl_unc_path(windows_path) {
        log::debug!(
            "[WSL] UNC->WSL Path converted: {} -> {}",
            windows_path,
            wsl_path
        );
        return wsl_path;
    }

    // 其他 UNC 路径（不支持）
    if windows_path.starts_with("\\\\") {
        log::warn!(
            "[WSL] UNC paths are not supported (except WSL): {}",
            windows_path
        );
        return windows_path.to_string();
    }

    // 检查是否为标准 Windows 路径 (C:\...)
    if windows_path.len() >= 2 && windows_path.chars().nth(1) == Some(':') {
        let Some(drive) = windows_path.chars().next().map(|c| c.to_ascii_lowercase()) else {
            return windows_path.to_string();
        };
        let rest = &windows_path[2..].replace('\\', "/");
        let wsl_path = format!("/mnt/{}{}", drive, rest);
        log::debug!("[WSL] Path converted: {} -> {}", windows_path, wsl_path);
        return wsl_path;
    }

    // 如果已经是 WSL 路径或相对路径，统一分隔符后返回
    windows_path.replace('\\', "/")
}

/// 将 Windows 路径转换为 WSL 路径（优先使用 wslpath，自动适配不同发行版的挂载策略）。
///
/// - 若输入是 \\wsl... UNC，则直接解析为 WSL 路径（同时可用于推断 distro）
/// - 若输入是盘符路径（C:\\...），在 Windows 上尝试：wsl [-d <distro>] -- wslpath -a -u <path>
/// - 失败则回退到 windows_to_wsl_path 的 /mnt/<drive> 规则
#[cfg(target_os = "windows")]
pub fn windows_to_wsl_path_with_distro(windows_path: &str, distro: Option<&str>) -> String {
    if windows_path.trim().is_empty() {
        return windows_path.to_string();
    }

    // 已是 WSL 路径
    if windows_path.starts_with('/') {
        return windows_path.to_string();
    }

    // WSL UNC 路径
    if let Some((_d, wsl_path)) = try_parse_wsl_unc_path(windows_path) {
        return wsl_path;
    }

    // 盘符路径：尽量用 wslpath 来得到正确挂载点
    if windows_path.len() >= 2 && windows_path.chars().nth(1) == Some(':') {
        let mut cmd = Command::new("wsl");
        if let Some(d) = distro {
            cmd.arg("-d").arg(d);
        }
        cmd.arg("--");
        cmd.arg("wslpath");
        cmd.arg("-a");
        cmd.arg("-u");
        cmd.arg(windows_path);
        cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let wsl_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !wsl_path.is_empty() && wsl_path.starts_with('/') {
                    log::debug!(
                        "[WSL] wslpath converted (distro={:?}): {} -> {}",
                        distro,
                        windows_path,
                        wsl_path
                    );
                    return wsl_path;
                }
            }
        }
    }

    windows_to_wsl_path(windows_path)
}

#[cfg(not(target_os = "windows"))]
pub fn windows_to_wsl_path_with_distro(windows_path: &str, _distro: Option<&str>) -> String {
    windows_to_wsl_path(windows_path)
}

/// 将 WSL 路径转换为 Windows 路径
///
/// # Examples
/// ```
/// assert_eq!(wsl_to_windows_path("/mnt/c/Users/test"), "C:\\Users\\test");
/// assert_eq!(wsl_to_windows_path("/home/user"), "/home/user"); // 无法转换
/// ```
pub fn wsl_to_windows_path(wsl_path: &str) -> String {
    if wsl_path.starts_with("/mnt/") && wsl_path.len() >= 6 {
        let Some(drive) = wsl_path.chars().nth(5).map(|c| c.to_ascii_uppercase()) else {
            return wsl_path.to_string();
        };
        let mut rest = wsl_path[6..].replace('/', "\\");
        if rest.is_empty() {
            rest = "\\".to_string();
        } else if !rest.starts_with('\\') {
            rest = format!("\\{}", rest);
        }
        let windows_path = format!("{}:{}", drive, rest);
        log::debug!("[WSL] Path converted: {} -> {}", wsl_path, windows_path);
        return windows_path;
    }

    // 无法转换的路径（如 /home/user）原样返回
    wsl_path.to_string()
}

/// 构建从 Windows 访问 WSL 文件系统的 UNC 路径
///
/// # Arguments
/// * `wsl_path` - WSL 内的路径，如 "/root/.codex/sessions"
/// * `distro` - WSL 发行版名称，如 "Debian"、"Ubuntu"
///
/// # Returns
/// Windows UNC 路径，如 "\\\\wsl.localhost\\Debian\\root\\.codex\\sessions"
pub fn build_wsl_unc_path(wsl_path: &str, distro: &str) -> PathBuf {
    // 尝试 wsl.localhost（Windows 10 2004+）
    let unc_path = format!(r"\\wsl.localhost\{}{}", distro, wsl_path.replace('/', "\\"));
    let path = PathBuf::from(&unc_path);

    // 检查路径是否可访问
    if path.exists() {
        return path;
    }

    // 尝试旧版路径格式 wsl$
    let legacy_path = format!(r"\\wsl$\{}{}", distro, wsl_path.replace('/', "\\"));
    let legacy = PathBuf::from(&legacy_path);

    if legacy.exists() {
        return legacy;
    }

    // 返回新版路径（即使不存在）
    path
}

// ============================================================================
// WSL 目录访问
// ============================================================================

/// 获取 WSL 中 .codex 目录的 Windows 访问路径
pub fn get_wsl_codex_dir() -> Option<PathBuf> {
    let config = get_wsl_config();
    config.codex_dir_unc.clone()
}

/// 获取 WSL 中 Codex 会话目录的 Windows 访问路径
pub fn get_wsl_codex_sessions_dir() -> Option<PathBuf> {
    get_wsl_codex_dir().map(|p| p.join("sessions"))
}

// ============================================================================
// WSL 命令构建
// ============================================================================

#[cfg(target_os = "windows")]
pub fn build_wsl_command_spec(
    program: &str,
    args: &[String],
    working_dir: Option<&str>,
    distro: Option<&str>,
) -> WslCommandSpec {
    // 如果 working_dir 是 \\wsl... UNC，则优先用其 distro（避免用户选择的目录在另一个发行版里）
    let (effective_distro, effective_cd) = effective_wsl_target(working_dir, distro);

    WslCommandSpec {
        program: program.to_string(),
        args: args.to_vec(),
        working_dir: effective_cd,
        distro: resolve_wsl_distro(effective_distro),
        marker: None,
    }
}

#[cfg(target_os = "windows")]
pub fn build_marked_wsl_command_spec(
    marker: &str,
    program: &str,
    args: &[String],
    working_dir: Option<&str>,
    distro: Option<&str>,
) -> WslCommandSpec {
    let mut spec = build_wsl_command_spec(program, args, working_dir, distro);
    spec.marker = Some(marker.to_string());
    spec
}

#[cfg(target_os = "windows")]
fn resolve_wsl_distro(distro: Option<String>) -> Option<String> {
    distro.or_else(get_default_wsl_distro)
}

#[cfg(target_os = "windows")]
fn effective_wsl_target(
    working_dir: Option<&str>,
    distro: Option<&str>,
) -> (Option<String>, Option<String>) {
    match working_dir {
        Some(dir) => {
            if let Some((unc_distro, wsl_dir)) = try_parse_wsl_unc_path(dir) {
                if let Some(d) = distro {
                    if !d.eq_ignore_ascii_case(&unc_distro) {
                        warn!(
                            "[WSL] working_dir points to distro '{}' but config distro is '{}'; using '{}'",
                            unc_distro, d, unc_distro
                        );
                    }
                }
                (Some(unc_distro), Some(wsl_dir))
            } else {
                (
                    distro.map(|d| d.to_string()),
                    Some(windows_to_wsl_path_with_distro(dir, distro)),
                )
            }
        }
        None => (distro.map(|d| d.to_string()), None),
    }
}

#[cfg(target_os = "windows")]
impl WslCommandSpec {
    pub fn into_command(&self) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new("wsl");

        // 指定发行版（如果提供）
        if let Some(ref d) = self.distro {
            cmd.arg("-d").arg(d);
        }

        // 设置工作目录（转换为 WSL 路径）
        if let Some(wsl_dir) = self.working_dir.as_deref() {
            cmd.arg("--cd").arg(wsl_dir);
        }

        // 添加分隔符和程序。若 marker 存在，通过环境变量写入 WSL 侧
        // 进程环境，取消时优先按该唯一 marker 清理，避免 pkill -f
        // 误命中同项目同参数的其他会话。
        cmd.arg("--");
        if let Some(marker) = self.marker.as_ref() {
            cmd.arg("env").arg(format!("ANY_CODE_RUN_ID={marker}"));
        }
        cmd.arg(&self.program);

        // 添加程序参数
        for arg in &self.args {
            cmd.arg(arg);
        }

        // 隐藏控制台窗口
        cmd.creation_flags(CREATE_NO_WINDOW);

        log::debug!(
            "[WSL] Built async command: wsl -d {:?} --cd {:?} -- marker={:?} {} {:?}",
            self.distro,
            self.working_dir,
            self.marker,
            self.program,
            self.args
        );

        cmd
    }
}

#[cfg(target_os = "windows")]
pub fn build_wsl_termination_command(
    spec: &WslCommandSpec,
    pid: u32,
    reason: &str,
) -> Result<std::process::Command, String> {
    if !spec.is_marked() {
        return Err(format!(
            "refusing WSL termination without unique marker for host PID {} ({})",
            pid, reason
        ));
    }

    let Some(marker) = spec
        .marker
        .as_deref()
        .filter(|marker| !marker.trim().is_empty())
    else {
        return Err(format!(
            "refusing WSL termination without unique marker for host PID {} ({})",
            pid, reason
        ));
    };

    let Some(distro) = spec
        .distro
        .as_deref()
        .filter(|distro| !distro.trim().is_empty())
    else {
        return Err(format!(
            "refusing WSL termination without resolved distro for host PID {} ({})",
            pid, reason
        ));
    };

    let mut cmd = std::process::Command::new("wsl");
    cmd.arg("-d").arg(distro);

    let marker = shell_quote(marker);
    let script = format!(
        "pids=$(grep -R -l -z -- {marker} /proc/[0-9]*/environ 2>/dev/null | sed -E 's#/proc/([0-9]+)/environ#\\1#' | grep -v \"^$$$\" || true); \
         if [ -n \"$pids\" ]; then kill -TERM $pids 2>/dev/null || true; sleep 1; kill -KILL $pids 2>/dev/null || true; fi; \
         remaining=$(grep -R -l -z -- {marker} /proc/[0-9]*/environ 2>/dev/null | sed -E 's#/proc/([0-9]+)/environ#\\1#' | grep -v \"^$$$\" || true); \
         if [ -n \"$remaining\" ]; then echo \"remaining marker pids: $remaining\" >&2; exit 1; fi",
        marker = marker
    );

    cmd.arg("--").arg("sh").arg("-lc").arg(script);
    cmd.creation_flags(CREATE_NO_WINDOW);

    log::warn!(
        "[WSL] Terminating marked WSL-side process for host PID {} ({}): marker={:?}, distro={:?}",
        pid,
        reason,
        spec.marker,
        spec.distro
    );

    Ok(cmd)
}

#[cfg(target_os = "windows")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\''"#))
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub fn build_wsl_command_spec(
    program: &str,
    args: &[String],
    _working_dir: Option<&str>,
    _distro: Option<&str>,
) -> WslCommandSpec {
    WslCommandSpec {
        program: program.to_string(),
        args: args.to_vec(),
        working_dir: None,
        distro: None,
        marker: None,
    }
}

#[cfg(not(target_os = "windows"))]
impl WslCommandSpec {
    #[allow(dead_code)]
    pub fn into_command(&self) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new(&self.program);
        for arg in &self.args {
            cmd.arg(arg);
        }
        cmd
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_windows_to_wsl_path() {
        assert_eq!(windows_to_wsl_path("C:\\Users\\test"), "/mnt/c/Users/test");
        assert_eq!(
            windows_to_wsl_path("D:\\Projects\\app"),
            "/mnt/d/Projects/app"
        );
        assert_eq!(windows_to_wsl_path("c:\\lower"), "/mnt/c/lower");
        assert_eq!(windows_to_wsl_path("C:\\"), "/mnt/c/");

        // WSL UNC paths
        assert_eq!(
            windows_to_wsl_path(r"\\wsl.localhost\Ubuntu\home\user\proj"),
            "/home/user/proj"
        );
        assert_eq!(
            windows_to_wsl_path(r"\\wsl$\Debian\mnt\c\Users\me"),
            "/mnt/c/Users/me"
        );
    }

    #[test]
    fn test_wsl_to_windows_path() {
        assert_eq!(wsl_to_windows_path("/mnt/c/Users/test"), "C:\\Users\\test");
        assert_eq!(wsl_to_windows_path("/mnt/d/Projects"), "D:\\Projects");
        assert_eq!(wsl_to_windows_path("/home/user"), "/home/user"); // 不转换
        assert_eq!(wsl_to_windows_path("/mnt/c"), "C:\\"); // 边界情况
    }

    #[test]
    fn test_build_wsl_unc_path() {
        let path = build_wsl_unc_path("/root/.codex/sessions", "Debian");
        let path_str = path.to_string_lossy();
        assert!(
            path_str.contains("wsl") && path_str.contains("Debian"),
            "Path should contain wsl and Debian: {}",
            path_str
        );
    }

    #[test]
    fn test_wsl_command_spec_preserves_launch_identity() {
        let args = vec!["exec".to_string(), "--json".to_string(), "-".to_string()];
        let spec =
            build_wsl_command_spec("codex", &args, Some("C:\\Projects\\demo"), Some("Ubuntu"));

        assert_eq!(spec.program, "codex");
        assert_eq!(spec.args, args);

        #[cfg(target_os = "windows")]
        {
            assert_eq!(spec.distro.as_deref(), Some("Ubuntu"));
            assert!(spec
                .working_dir
                .as_deref()
                .map(|path| path.starts_with('/'))
                .unwrap_or(false));
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_marked_wsl_command_spec_uses_unique_marker_for_termination() {
        let args = vec!["exec".to_string(), "--json".to_string(), "-".to_string()];
        let marker = "any-code-codex-test-marker";
        let spec = build_marked_wsl_command_spec(
            marker,
            "codex",
            &args,
            Some("C:\\Projects\\demo"),
            Some("Ubuntu"),
        );

        assert_eq!(spec.marker.as_deref(), Some(marker));

        let termination = build_wsl_termination_command(&spec, 12345, "test")
            .expect("marked WSL spec should build a termination command");
        let script = termination
            .get_args()
            .last()
            .expect("termination script should be passed as the final arg")
            .to_string_lossy()
            .to_string();

        assert!(
            script.contains(marker),
            "termination script should search for the unique marker: {script}"
        );
        assert!(
            script.contains("/proc/[0-9]*/environ"),
            "termination should inspect WSL-side process environments: {script}"
        );
        assert!(
            script.contains("kill -TERM") && script.contains("kill -KILL"),
            "termination should kill only marker-matched pids: {script}"
        );
        assert!(
            !script.contains("pkill"),
            "marked termination must not fall back to pattern pkill: {script}"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_unmarked_wsl_termination_is_refused() {
        let args = vec!["exec".to_string(), "--json".to_string(), "-".to_string()];
        let spec =
            build_wsl_command_spec("codex", &args, Some("C:\\Projects\\demo"), Some("Ubuntu"));

        let err = build_wsl_termination_command(&spec, 12345, "test")
            .expect_err("unmarked WSL specs must not be terminable by command pattern");

        assert!(
            err.contains("without unique marker"),
            "unexpected error for unmarked termination refusal: {err}"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_wsl_command_spec_resolves_distro_for_windows_paths() {
        let args = vec!["exec".to_string(), "--json".to_string(), "-".to_string()];
        let spec = build_marked_wsl_command_spec(
            "any-code-codex-test-marker",
            "codex",
            &args,
            Some("C:\\Projects\\demo"),
            Some("Ubuntu"),
        );

        assert_eq!(spec.distro.as_deref(), Some("Ubuntu"));
    }
}
