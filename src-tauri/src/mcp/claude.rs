//! Claude MCP 同步和导入模块

use serde_json::Value;
use std::collections::HashMap;

/// 将单个 MCP 服务器同步到 Claude live 配置
pub fn sync_single_server_to_claude(id: &str, server_spec: &Value) -> Result<(), String> {
    // 读取现有的 MCP 配置
    let current = crate::claude_mcp::read_mcp_servers_map()?;

    // 创建新的 HashMap，包含现有的所有服务器 + 当前要同步的服务器
    let mut updated = current;
    updated.insert(id.to_string(), server_spec.clone());

    // 写回
    crate::claude_mcp::set_mcp_servers_map(&updated)
}

/// 从 Claude live 配置中移除单个 MCP 服务器
pub fn remove_server_from_claude(id: &str) -> Result<(), String> {
    // 读取现有的 MCP 配置
    let mut current = crate::claude_mcp::read_mcp_servers_map()?;

    // 移除指定服务器
    current.remove(id);

    // 写回
    crate::claude_mcp::set_mcp_servers_map(&current)
}

/// 从 ~/.claude.json 导入 mcpServers
pub fn import_from_claude() -> Result<HashMap<String, Value>, String> {
    // 直接使用 claude_mcp 模块的读取函数（更可靠）
    let servers = crate::claude_mcp::read_mcp_servers_map()?;

    log::info!("从 Claude 读取到 {} 个 MCP 服务器", servers.len());

    // 不进行严格验证，保持原始数据
    // 验证会在同步时进行
    Ok(servers)
}

/// 将多个服务器同步到 Claude
pub fn sync_servers_to_claude(servers: &HashMap<String, Value>) -> Result<(), String> {
    crate::claude_mcp::set_mcp_servers_map(servers)
}
