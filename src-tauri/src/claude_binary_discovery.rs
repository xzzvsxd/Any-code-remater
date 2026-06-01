use log::{debug, info, warn};
use std::path::PathBuf;
use std::process::Command;

use crate::claude_binary::{
    compare_node_versions, extract_version_from_output, get_claude_version, get_home_dir, test_claude_binary,
    ClaudeInstallation, InstallationType,
};

pub(crate) fn discover_system_installations() -> Vec<ClaudeInstallation> {
    let mut installations = Vec::new();

    // 1. Try system path lookup command (where/which)
    if let Some(installation) = try_where_command() {
        installations.push(installation);
    }

    // 2. Try aliased which command
    if let Some(installation) = try_which_command() {
        installations.push(installation);
    }

    // 3. Check NVM paths (cross-platform)
    installations.extend(find_nvm_installations());

    // 4. Check standard paths (cross-platform)
    installations.extend(find_standard_installations());

    // 5. Check platform-specific paths
    installations.extend(find_windows_installations());
    installations.extend(find_macos_installations());

    // Remove duplicates by path
    let mut unique_paths = std::collections::HashSet::new();
    installations.retain(|install| unique_paths.insert(install.path.clone()));

    // Test each installation for actual functionality with timeout
    // 🔧 FIX: In debug/development mode, be more lenient with testing
    // Development builds may have stricter security restrictions that prevent spawning processes
    #[cfg(debug_assertions)]
    {
        // In dev mode, if binary exists on disk and is a file, consider it valid
        // This avoids issues with process spawning restrictions in Tauri dev mode
        installations.retain(|install| {
            // For PATH-based lookups (e.g., "claude" without full path), try to test
            if !install.path.contains('/') && !install.path.contains('\\') {
                let is_functional = test_claude_binary(&install.path);
                if !is_functional {
                    warn!(
                        "Claude installation at {} is not functional in dev mode, removing from list",
                        install.path
                    );
                }
                return is_functional;
            }

            // For full paths, just check if file exists (more lenient in dev mode)
            let path_buf = PathBuf::from(&install.path);
            let exists = path_buf.exists() && path_buf.is_file();
            if exists {
                info!(
                    "Dev mode: Found Claude at {} (skipping functionality test)",
                    install.path
                );
            } else {
                warn!(
                    "Dev mode: Claude path does not exist: {}",
                    install.path
                );
            }
            exists
        });
    }

    #[cfg(not(debug_assertions))]
    {
        // In production builds, perform full functionality tests
        installations.retain(|install| {
            let is_functional = test_claude_binary(&install.path);
            if !is_functional {
                warn!(
                    "Claude installation at {} is not functional, removing from list",
                    install.path
                );
            }
            is_functional
        });
    }

    installations
}

/// Try using the system path lookup command to find Claude (cross-platform)
fn try_where_command() -> Option<ClaudeInstallation> {
    #[cfg(target_os = "windows")]
    let (command, source) = ("where", "where");
    #[cfg(not(target_os = "windows"))]
    let (command, source) = ("which", "which");

    debug!("Trying '{}' to find claude binary...", command);

    let mut cmd = Command::new(command);
    cmd.arg("claude");

    // Add CREATE_NO_WINDOW flag on Windows to prevent terminal window popup
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    // On macOS, set the shell PATH so 'which' can find binaries installed via npm/nvm/etc.
    #[cfg(target_os = "macos")]
    {
        if let Some(shell_path) = crate::claude_binary::get_shell_path() {
            debug!("Setting PATH for 'which' command: {}", shell_path);
            cmd.env("PATH", &shell_path);
        }
    }

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let output_str = String::from_utf8_lossy(&output.stdout).trim().to_string();

            if output_str.is_empty() {
                return None;
            }

            // 'where' can return multiple paths, take the first one
            let path = output_str.lines().next()?.trim().to_string();

            debug!("'{}' found claude at: {}", command, path);

            // Verify the path exists
            if !PathBuf::from(&path).exists() {
                warn!("Path from '{}' does not exist: {}", command, path);
                return None;
            }

            // Get version
            let version = get_claude_version(&path).ok().flatten();

            Some(ClaudeInstallation {
                path,
                version,
                source: source.to_string(),
                installation_type: InstallationType::System,
            })
        }
        _ => None,
    }
}

/// Try parsing aliased which output (mostly for macOS/Linux)
fn try_which_command() -> Option<ClaudeInstallation> {
    #[cfg(target_os = "windows")]
    let command = "where";
    #[cfg(not(target_os = "windows"))]
    let command = "which";

    debug!("Trying '{}' with alias parsing...", command);

    let mut cmd = Command::new(command);
    cmd.arg("claude");

    // Add CREATE_NO_WINDOW flag on Windows to prevent terminal window popup
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    // On macOS, set the shell PATH so 'which' can find binaries installed via npm/nvm/etc.
    #[cfg(target_os = "macos")]
    {
        if let Some(shell_path) = crate::claude_binary::get_shell_path() {
            debug!("Setting PATH for 'which' alias parsing: {}", shell_path);
            cmd.env("PATH", &shell_path);
        }
    }

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let output_str = String::from_utf8_lossy(&output.stdout).trim().to_string();

            if output_str.is_empty() {
                return None;
            }

            // Parse aliased output: "claude: aliased to /path/to/claude"
            let path = if output_str.starts_with("claude:") && output_str.contains("aliased to") {
                output_str
                    .split("aliased to")
                    .nth(1)
                    .map(|s| s.trim().to_string())
            } else {
                Some(output_str.lines().next()?.trim().to_string())
            }?;

            debug!("'{}' found claude at: {}", command, path);

            // Verify the path exists
            if !PathBuf::from(&path).exists() {
                warn!("Path from '{}' does not exist: {}", command, path);
                return None;
            }

            // Get version
            let version = get_claude_version(&path).ok().flatten();

            Some(ClaudeInstallation {
                path,
                version,
                source: command.to_string(),
                installation_type: InstallationType::System,
            })
        }
        _ => None,
    }
}

/// Find Claude installations in NVM directories (cross-platform)
/// 🔥 增强：按 Node 版本号降序排列，确保最新版本的 claude cli 优先
fn find_nvm_installations() -> Vec<ClaudeInstallation> {
    let mut installations = Vec::new();

    // Get home directory based on platform
    let home = get_home_dir().ok();
    if home.is_none() {
        return installations;
    }
    let home = home.unwrap();

    let nvm_dir = PathBuf::from(&home)
        .join(".nvm")
        .join("versions")
        .join("node");

    debug!("Checking NVM directory: {:?}", nvm_dir);

    if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
        // 收集所有 Node 版本目录
        let mut node_dirs: Vec<_> = entries
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .collect();

        // 🔥 按 Node 版本号降序排列（最新版本在前）
        node_dirs.sort_by(|a, b| {
            let a_ver = a.file_name().to_string_lossy().to_string();
            let b_ver = b.file_name().to_string_lossy().to_string();
            compare_node_versions(&b_ver, &a_ver)
        });

        info!(
            "Found {} NVM node versions, sorted by version (newest first)",
            node_dirs.len()
        );

        for entry in node_dirs {
            // Platform-specific binary names
            #[cfg(target_os = "windows")]
            let claude_names = vec!["claude.cmd", "claude"];
            #[cfg(not(target_os = "windows"))]
            let claude_names = vec!["claude"];

            for name in claude_names {
                let claude_path = entry.path().join("bin").join(name);
                if claude_path.exists() && claude_path.is_file() {
                    let path_str = claude_path.to_string_lossy().to_string();
                    let node_version = entry.file_name().to_string_lossy().to_string();

                    info!("Found Claude in NVM node {}: {}", node_version, path_str);

                    // Get Claude version
                    let version = get_claude_version(&path_str).ok().flatten();

                    installations.push(ClaudeInstallation {
                        path: path_str,
                        version: version.clone(),
                        source: format!("nvm ({})", node_version),
                        installation_type: InstallationType::System,
                    });

                    // 记录版本信息
                    if let Some(v) = &version {
                        info!("  -> Claude version: {} (Node {})", v, node_version);
                    }

                    break; // Only add one per node version
                }
            }
        }
    }

    // 🔥 日志：显示找到的所有 NVM 安装
    if !installations.is_empty() {
        info!(
            "Total NVM Claude installations found: {} (will prefer newest version)",
            installations.len()
        );
    }

    installations
}

/// Check standard installation paths (cross-platform)
fn find_standard_installations() -> Vec<ClaudeInstallation> {
    let mut installations = Vec::new();
    let mut paths_to_check: Vec<(String, String)> = vec![];

    // Get home directory based on platform
    if let Ok(home) = get_home_dir() {
        // Common paths for both platforms
        paths_to_check.extend(vec![
            (
                format!("{}/.claude/local/claude", home),
                "claude-local".to_string(),
            ),
            (
                format!("{}/.local/bin/claude", home),
                "local-bin".to_string(),
            ),
            (
                format!("{}/.npm-global/bin/claude", home),
                "npm-global".to_string(),
            ),
            (format!("{}/.yarn/bin/claude", home), "yarn".to_string()),
            (format!("{}/.bun/bin/claude", home), "bun".to_string()),
            (format!("{}/bin/claude", home), "home-bin".to_string()),
            (
                format!("{}/node_modules/.bin/claude", home),
                "node-modules".to_string(),
            ),
            (
                format!("{}/.config/yarn/global/node_modules/.bin/claude", home),
                "yarn-global".to_string(),
            ),
        ]);

        // Windows-specific paths
        #[cfg(target_os = "windows")]
        {
            paths_to_check.extend(vec![
                (
                    format!("{}/AppData/Roaming/npm/claude.cmd", home),
                    "npm-global-windows".to_string(),
                ),
                (
                    format!("{}/AppData/Roaming/npm/claude", home),
                    "npm-global-windows".to_string(),
                ),
            ]);
        }

        // macOS-specific paths
        #[cfg(target_os = "macos")]
        {
            paths_to_check.extend(vec![
                (
                    "/usr/local/bin/claude".to_string(),
                    "usr-local-bin".to_string(),
                ),
                (
                    "/opt/homebrew/bin/claude".to_string(),
                    "homebrew".to_string(),
                ),
            ]);
        }
    }

    // Check each path
    for (path, source) in paths_to_check {
        let path_buf = PathBuf::from(&path);
        if path_buf.exists() && path_buf.is_file() {
            debug!("Found claude at standard path: {} ({})", path, source);

            // Get version
            let version = get_claude_version(&path).ok().flatten();

            installations.push(ClaudeInstallation {
                path,
                version,
                source,
                installation_type: InstallationType::System,
            });
        }
    }

    // Check if claude is available in PATH (cross-platform)
    #[cfg(target_os = "windows")]
    let claude_commands = vec!["claude", "claude.cmd"];
    #[cfg(not(target_os = "windows"))]
    let claude_commands = vec!["claude"];

    for cmd in claude_commands {
        let mut command = Command::new(cmd);
        command.arg("--version");

        // Add CREATE_NO_WINDOW flag on Windows to prevent terminal window popup
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        if let Ok(output) = command.output() {
            if output.status.success() {
                debug!("{} is available in PATH", cmd);
                let version = extract_version_from_output(&output.stdout);

                installations.push(ClaudeInstallation {
                    path: cmd.to_string(),
                    version,
                    source: "PATH".to_string(),
                    installation_type: InstallationType::System,
                });
                break; // Only add one PATH entry
            }
        }
    }

    installations
}

/// Find Windows-specific Claude installations
fn find_windows_installations() -> Vec<ClaudeInstallation> {
    let mut installations = Vec::new();

    // Windows-specific paths
    let mut paths_to_check: Vec<(String, String)> = vec![];

    // Check Program Files locations
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        paths_to_check.extend(vec![
            (
                format!("{}\\nodejs\\claude.cmd", program_files),
                "nodejs".to_string(),
            ),
            (
                format!("{}\\nodejs\\claude", program_files),
                "nodejs".to_string(),
            ),
        ]);
    }

    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        paths_to_check.extend(vec![
            (
                format!("{}\\nodejs\\claude.cmd", program_files_x86),
                "nodejs-x86".to_string(),
            ),
            (
                format!("{}\\nodejs\\claude", program_files_x86),
                "nodejs-x86".to_string(),
            ),
        ]);
    }

    // Check AppData locations
    if let Ok(appdata) = std::env::var("APPDATA") {
        paths_to_check.extend(vec![
            (
                format!("{}\\npm\\claude.cmd", appdata),
                "npm-appdata".to_string(),
            ),
            (
                format!("{}\\npm\\claude", appdata),
                "npm-appdata".to_string(),
            ),
        ]);
    }

    // Check each path
    for (path, source) in paths_to_check {
        let path_buf = PathBuf::from(&path);
        if path_buf.exists() && path_buf.is_file() {
            debug!("Found claude at Windows path: {} ({})", path, source);

            // Get version
            let version = get_claude_version(&path).ok().flatten();

            installations.push(ClaudeInstallation {
                path,
                version,
                source,
                installation_type: InstallationType::System,
            });
        }
    }

    installations
}

/// Find macOS-specific Claude installations
#[cfg(target_os = "macos")]
fn find_macos_installations() -> Vec<ClaudeInstallation> {
    let mut installations = Vec::new();
    let mut paths_to_check: Vec<(String, String)> = vec![];

    // ⚡ 增强：添加更多 macOS 新系统的路径

    // Homebrew paths (both Intel and Apple Silicon)
    paths_to_check.extend(vec![
        (
            "/usr/local/bin/claude".to_string(),
            "homebrew-intel".to_string(),
        ),
        (
            "/opt/homebrew/bin/claude".to_string(),
            "homebrew-arm".to_string(),
        ),
    ]);

    // MacPorts
    paths_to_check.push(("/opt/local/bin/claude".to_string(), "macports".to_string()));

    // NPM 全局安装路径（最新 macOS 常见）
    paths_to_check.extend(vec![
        (
            "/usr/local/share/npm/bin/claude".to_string(),
            "npm-system".to_string(),
        ),
        (
            "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.js".to_string(),
            "homebrew-npm".to_string(),
        ),
        (
            "/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.js".to_string(),
            "npm-lib".to_string(),
        ),
    ]);

    // System-wide installations
    paths_to_check.push(("/usr/bin/claude".to_string(), "system".to_string()));

    // 检查用户目录下的 npm/pnpm 路径
    if let Ok(home) = get_home_dir() {
        paths_to_check.extend(vec![
            // npm prefix 自定义路径
            (format!("{}/npm/bin/claude", home), "npm-custom".to_string()),
            (
                format!("{}/.npm/bin/claude", home),
                "npm-hidden".to_string(),
            ),
            // pnpm 全局路径
            (
                format!("{}/Library/pnpm/claude", home),
                "pnpm-library".to_string(),
            ),
            (
                format!("{}/.local/share/pnpm/claude", home),
                "pnpm-local".to_string(),
            ),
            (
                format!("{}/.pnpm-global/bin/claude", home),
                "pnpm-global".to_string(),
            ),
            // Node 版本管理器路径 - n
            (format!("{}/.n/bin/claude", home), "n-version".to_string()),
            // asdf
            (format!("{}/.asdf/shims/claude", home), "asdf".to_string()),
            // Volta
            (format!("{}/.volta/bin/claude", home), "volta".to_string()),
            // fnm (Fast Node Manager) paths
            (
                format!("{}/.fnm/aliases/default/bin/claude", home),
                "fnm".to_string(),
            ),
            (
                format!("{}/.local/share/fnm/aliases/default/bin/claude", home),
                "fnm-local".to_string(),
            ),
            (
                format!(
                    "{}/Library/Application Support/fnm/aliases/default/bin/claude",
                    home
                ),
                "fnm-app-support".to_string(),
            ),
            // nvm current symlink (points to currently active node version)
            (
                format!("{}/.nvm/current/bin/claude", home),
                "nvm-current".to_string(),
            ),
            // Additional npm global paths that users commonly configure
            (
                format!("{}/node_modules/.bin/claude", home),
                "home-node-modules".to_string(),
            ),
        ]);

        // 🔥 动态获取 npm prefix 并添加路径
        if let Some(npm_prefix) = crate::claude_binary::get_npm_prefix() {
            let npm_bin_path = format!("{}/bin/claude", npm_prefix);
            if !paths_to_check.iter().any(|(p, _)| p == &npm_bin_path) {
                debug!("Adding npm prefix path: {}", npm_bin_path);
                paths_to_check.push((npm_bin_path, "npm-prefix".to_string()));
            }
        }

        // 🔥 扫描 nvm 的 node 版本目录
        let nvm_versions_dir = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_versions_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let claude_path = entry.path().join("bin").join("claude");
                    if claude_path.exists() {
                        let node_version = entry.file_name().to_string_lossy().to_string();
                        paths_to_check.push((
                            claude_path.to_string_lossy().to_string(),
                            format!("nvm-{}", node_version),
                        ));
                    }
                }
            }
        }

        // 🔥 扫描 fnm 的 node 版本目录
        for fnm_base in &[
            format!("{}/.fnm/node-versions", home),
            format!("{}/.local/share/fnm/node-versions", home),
            format!("{}/Library/Application Support/fnm/node-versions", home),
        ] {
            if let Ok(entries) = std::fs::read_dir(fnm_base) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        let claude_path =
                            entry.path().join("installation").join("bin").join("claude");
                        if claude_path.exists() {
                            let node_version = entry.file_name().to_string_lossy().to_string();
                            paths_to_check.push((
                                claude_path.to_string_lossy().to_string(),
                                format!("fnm-{}", node_version),
                            ));
                        }
                    }
                }
            }
        }
    }

    // Check each path
    for (path, source) in paths_to_check {
        let path_buf = PathBuf::from(&path);
        if path_buf.exists() && path_buf.is_file() {
            debug!("Found claude at macOS path: {} ({})", path, source);

            // Get version
            let version = get_claude_version(&path).ok().flatten();

            installations.push(ClaudeInstallation {
                path,
                version,
                source,
                installation_type: InstallationType::System,
            });
        }
    }

    installations
}

#[cfg(not(target_os = "macos"))]
fn find_macos_installations() -> Vec<ClaudeInstallation> {
    vec![]
}
