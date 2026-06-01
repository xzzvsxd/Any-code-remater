//! Claude MCP 配置文件操作模块
//!
//! 负责直接读写 ~/.claude.json 中的 mcpServers 配置

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub user_config_path: String,
    pub user_config_exists: bool,
    pub server_count: usize,
}

/// 获取 Claude MCP 配置文件路径
///
/// MCP 配置文件路径：
/// - 默认：~/.claude.json（所有平台统一）
/// - 如果设置了 CLAUDE_CONFIG_DIR 环境变量，使用派生路径
///
/// 注意：~/.claude/settings.json 是 Claude Code CLI 的主配置文件，MCP 配置应该在 ~/.claude.json
fn user_config_path() -> PathBuf {
    let home_dir = dirs::home_dir().expect("Failed to get home directory");

    // Claude MCP 配置文件固定为 ~/.claude.json（参考 cc-switch 项目实现）
    home_dir.join(".claude.json")
}

/// 读取 JSON 文件
fn read_json_value(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = fs::read_to_string(path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    let value: Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {}", e))?;

    Ok(value)
}

/// 原子写入 JSON 文件
fn write_json_value(path: &Path, value: &Value) -> Result<(), String> {
    // 确保父目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    // 美化输出
    let json =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化 JSON 失败: {}", e))?;

    // 原子写入（先写临时文件，再重命名）
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, json.as_bytes()).map_err(|e| format!("写入临时文件失败: {}", e))?;

    fs::rename(&tmp_path, path).map_err(|e| format!("重命名文件失败: {}", e))?;

    Ok(())
}

/// 获取 MCP 状态
pub fn get_mcp_status() -> Result<McpStatus, String> {
    let path = user_config_path();
    let (exists, count) = if path.exists() {
        let v = read_json_value(&path)?;
        let servers = v.get("mcpServers").and_then(|x| x.as_object());
        (true, servers.map(|m| m.len()).unwrap_or(0))
    } else {
        (false, 0)
    };

    Ok(McpStatus {
        user_config_path: path.to_string_lossy().to_string(),
        user_config_exists: exists,
        server_count: count,
    })
}

/// 读取 mcp.json 文本内容
pub fn read_mcp_json() -> Result<Option<String>, String> {
    let path = user_config_path();
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    Ok(Some(content))
}

/// 验证命令是否在 PATH 中可用
pub fn validate_command_in_path(cmd: &str) -> Result<bool, String> {
    if cmd.trim().is_empty() {
        return Ok(false);
    }

    // 如果包含路径分隔符，直接判断是否存在可执行文件
    if cmd.contains('/') || cmd.contains('\\') {
        return Ok(Path::new(cmd).exists());
    }

    let path_var = std::env::var_os("PATH").unwrap_or_default();
    let paths = std::env::split_paths(&path_var);

    #[cfg(windows)]
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or(".COM;.EXE;.BAT;.CMD".into())
        .split(';')
        .map(|s| s.trim().to_uppercase())
        .collect();

    for p in paths {
        let candidate = p.join(cmd);
        if candidate.is_file() {
            return Ok(true);
        }

        #[cfg(windows)]
        {
            for ext in &exts {
                let cand = p.join(format!("{}{}", cmd, ext));
                if cand.is_file() {
                    return Ok(true);
                }
            }
        }
    }

    Ok(false)
}

/// 读取 ~/.claude.json 中的 mcpServers 映射
pub fn read_mcp_servers_map() -> Result<HashMap<String, Value>, String> {
    let path = user_config_path();
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let root = read_json_value(&path)?;
    let servers = root
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .map(|obj| obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();

    Ok(servers)
}

/// 将给定的启用 MCP 服务器映射写入到 ~/.claude.json 的 mcpServers 字段
/// 仅覆盖 mcpServers，其他字段保持不变
pub fn set_mcp_servers_map(servers: &HashMap<String, Value>) -> Result<(), String> {
    let path = user_config_path();
    let mut root = read_json_value(&path)?;

    // 构建 mcpServers 对象：移除 UI 辅助字段，仅保留实际 MCP 规范
    let mut out: Map<String, Value> = Map::new();
    for (id, spec) in servers.iter() {
        let mut obj = if let Some(map) = spec.as_object() {
            map.clone()
        } else {
            return Err(format!("MCP 服务器 '{}' 不是对象", id));
        };

        // 如果有 server 字段，提取出来
        if let Some(server_val) = obj.remove("server") {
            let server_obj = server_val
                .as_object()
                .cloned()
                .ok_or_else(|| format!("MCP 服务器 '{}' server 字段不是对象", id))?;
            obj = server_obj;
        }

        // 移除 UI 辅助字段
        obj.remove("enabled");
        obj.remove("source");
        obj.remove("id");
        obj.remove("name");
        obj.remove("description");
        obj.remove("tags");
        obj.remove("homepage");
        obj.remove("docs");

        out.insert(id.clone(), Value::Object(obj));
    }

    {
        let obj = root
            .as_object_mut()
            .ok_or_else(|| "配置文件根必须是对象".to_string())?;
        obj.insert("mcpServers".into(), Value::Object(out));
    }

    write_json_value(&path, &root)?;
    Ok(())
}
