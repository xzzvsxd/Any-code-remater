use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::super::wsl_utils;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderConfig {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub website_url: Option<String>,
    pub category: Option<String>,
    pub auth: serde_json::Value, // JSON object for auth.json
    pub config: String,          // TOML string for config.toml
    pub is_official: Option<bool>,
    pub is_partner: Option<bool>,
    pub created_at: Option<i64>,
}

/// Current Codex configuration (from ~/.codex directory)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentCodexConfig {
    pub auth: serde_json::Value,
    pub config: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

/// Check if WSL mode should be used for Codex configuration.
fn should_use_wsl_config() -> bool {
    let wsl_config = wsl_utils::get_wsl_config();
    wsl_config.enabled && wsl_config.codex_dir_unc.is_some()
}

/// Get Codex config directory path (supports both Native and WSL modes).
fn get_codex_config_dir() -> Result<PathBuf, String> {
    // Check if WSL mode is enabled
    if should_use_wsl_config() {
        if let Some(wsl_dir) = wsl_utils::get_wsl_codex_dir() {
            log::info!("[Codex Provider] Using WSL config directory: {:?}", wsl_dir);
            return Ok(wsl_dir);
        }
    }

    // Fall back to native Windows path
    let home_dir = dirs::home_dir().ok_or_else(|| "Cannot get home directory".to_string())?;
    let native_dir = home_dir.join(".codex");
    log::debug!(
        "[Codex Provider] Using native config directory: {:?}",
        native_dir
    );
    Ok(native_dir)
}

/// Get Codex auth.json path
fn get_codex_auth_path() -> Result<PathBuf, String> {
    Ok(get_codex_config_dir()?.join("auth.json"))
}

/// Get Codex config.toml path
fn get_codex_config_path() -> Result<PathBuf, String> {
    Ok(get_codex_config_dir()?.join("config.toml"))
}

/// Get Codex providers.json path (for custom presets)
/// Note: Providers are stored in native Windows path, not WSL
/// because they are managed by Workbench, not by Codex CLI
fn get_codex_providers_path() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Cannot get home directory".to_string())?;
    Ok(home_dir.join(".codex").join("providers.json"))
}

/// Extract API key from auth JSON
fn extract_api_key_from_auth(auth: &serde_json::Value) -> Option<String> {
    auth.get("OPENAI_API_KEY")
        .or_else(|| auth.get("OPENAI_KEY"))
        .or_else(|| auth.get("API_KEY"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Extract base_url from config.toml text
fn extract_base_url_from_config(config: &str) -> Option<String> {
    let re = regex::Regex::new(r#"base_url\s*=\s*"([^"]+)""#).ok()?;
    re.captures(config)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

/// Extract model from config.toml text
fn extract_model_from_config(config: &str) -> Option<String> {
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("model =") {
            let re = regex::Regex::new(r#"model\s*=\s*"([^"]+)""#).ok()?;
            return re
                .captures(trimmed)
                .and_then(|caps| caps.get(1))
                .map(|m| m.as_str().to_string());
        }
    }
    None
}

// ============================================================================
// Provider Management Commands
// ============================================================================

/// Get Codex provider presets (custom user-defined presets)
#[tauri::command]
pub async fn get_codex_provider_presets() -> Result<Vec<CodexProviderConfig>, String> {
    log::info!("[Codex Provider] Getting provider presets");

    let providers_path = get_codex_providers_path()?;

    if !providers_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&providers_path)
        .map_err(|e| format!("Failed to read providers.json: {}", e))?;

    let providers: Vec<CodexProviderConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse providers.json: {}", e))?;

    Ok(providers)
}

/// Get current Codex configuration
/// Supports both Native Windows and WSL modes
#[tauri::command]
pub async fn get_current_codex_config() -> Result<CurrentCodexConfig, String> {
    let is_wsl_mode = should_use_wsl_config();
    log::info!(
        "[Codex Provider] Getting current config (WSL mode: {})",
        is_wsl_mode
    );

    let auth_path = get_codex_auth_path()?;
    let config_path = get_codex_config_path()?;

    log::debug!("[Codex Provider] Auth path: {:?}", auth_path);
    log::debug!("[Codex Provider] Config path: {:?}", config_path);

    // Read auth.json
    let auth: serde_json::Value = if auth_path.exists() {
        let content = fs::read_to_string(&auth_path)
            .map_err(|e| format!("Failed to read auth.json: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse auth.json: {}", e))?
    } else {
        serde_json::json!({})
    };

    // Read config.toml
    let config: String = if config_path.exists() {
        fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.toml: {}", e))?
    } else {
        String::new()
    };

    // Extract values
    let api_key = extract_api_key_from_auth(&auth);
    let base_url = extract_base_url_from_config(&config);
    let model = extract_model_from_config(&config);

    Ok(CurrentCodexConfig {
        auth,
        config,
        api_key,
        base_url,
        model,
    })
}

/// Switch to a Codex provider configuration
/// Preserves user's custom settings and OAuth tokens
/// Supports both Native Windows and WSL modes
#[tauri::command]
pub async fn switch_codex_provider(config: CodexProviderConfig) -> Result<String, String> {
    log::info!("[Codex Provider] Switching to provider: {}", config.name);

    let is_wsl_mode = should_use_wsl_config();
    log::info!("[Codex Provider] WSL mode: {}", is_wsl_mode);

    let config_dir = get_codex_config_dir()?;
    let auth_path = get_codex_auth_path()?;
    let config_path = get_codex_config_path()?;

    log::info!("[Codex Provider] Config directory: {:?}", config_dir);
    log::info!("[Codex Provider] Auth path: {:?}", auth_path);
    log::info!("[Codex Provider] Config path: {:?}", config_path);

    // Ensure config directory exists
    if !config_dir.exists() {
        log::info!(
            "[Codex Provider] Creating config directory: {:?}",
            config_dir
        );
        fs::create_dir_all(&config_dir).map_err(|e| {
            format!(
                "Failed to create .codex directory at {:?}: {}",
                config_dir, e
            )
        })?;
    }

    // Validate new TOML if not empty
    let new_config_table: Option<toml::Table> = if !config.config.trim().is_empty() {
        Some(
            toml::from_str(&config.config)
                .map_err(|e| format!("Invalid TOML configuration: {}", e))?,
        )
    } else {
        None
    };

    // Merge auth.json - preserve existing OAuth tokens and other credentials
    // API key related fields that should be cleared when switching to official auth
    let api_key_fields = ["OPENAI_API_KEY", "OPENAI_KEY", "API_KEY"];

    let final_auth = if auth_path.exists() {
        let existing_content = fs::read_to_string(&auth_path)
            .map_err(|e| format!("Failed to read existing auth.json: {}", e))?;

        if let Ok(mut existing_auth) =
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&existing_content)
        {
            // Merge new auth into existing - new values take precedence
            if let serde_json::Value::Object(new_auth_map) = serde_json::to_value(&config.auth)
                .map_err(|e| format!("Failed to convert auth: {}", e))?
            {
                // Check if new auth has any API key set (non-empty value)
                let new_auth_has_api_key = api_key_fields.iter().any(|key| {
                    new_auth_map.get(*key).map_or(false, |v| {
                        !v.is_null() && v != &serde_json::Value::String(String::new())
                    })
                });

                // If new auth doesn't have API key (e.g., switching to official OAuth),
                // clear existing API key fields to avoid using stale credentials
                if !new_auth_has_api_key {
                    for key in &api_key_fields {
                        existing_auth.remove(*key);
                    }
                    log::info!("[Codex Provider] Cleared API key fields for official auth mode");
                }

                for (key, value) in new_auth_map {
                    // Only update if the new value is not empty/null
                    if !value.is_null() && value != serde_json::Value::String(String::new()) {
                        existing_auth.insert(key, value);
                    }
                }
            }
            serde_json::Value::Object(existing_auth)
        } else {
            // Existing auth is invalid, use new auth directly
            serde_json::to_value(&config.auth)
                .map_err(|e| format!("Failed to convert auth: {}", e))?
        }
    } else {
        // No existing auth, use new auth directly
        serde_json::to_value(&config.auth).map_err(|e| format!("Failed to convert auth: {}", e))?
    };

    // Write merged auth.json
    let auth_content = serde_json::to_string_pretty(&final_auth)
        .map_err(|e| format!("Failed to serialize auth: {}", e))?;
    fs::write(&auth_path, auth_content).map_err(|e| format!("Failed to write auth.json: {}", e))?;

    // Merge config.toml - preserve user's custom settings
    let final_config = if config_path.exists() {
        let existing_content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read existing config.toml: {}", e))?;

        if let Ok(mut existing_table) = toml::from_str::<toml::Table>(&existing_content) {
            // Provider-specific keys that will be overwritten
            let provider_keys = [
                "model_provider",
                "model",
                "model_providers",
                "model_reasoning_effort",
            ];

            if let Some(new_table) = new_config_table {
                // Remove provider-specific keys from existing config
                for key in &provider_keys {
                    existing_table.remove(*key);
                }
                if let Some(features) = existing_table
                    .get_mut("features")
                    .and_then(|value| value.as_table_mut())
                {
                    features.remove("fast_mode");
                }

                // Merge: new provider settings take precedence
                for (key, value) in new_table {
                    existing_table.insert(key, value);
                }

                // Serialize back to TOML string
                toml::to_string_pretty(&existing_table)
                    .map_err(|e| format!("Failed to serialize merged config: {}", e))?
            } else {
                // New config is empty (official OpenAI), just remove provider keys
                for key in &provider_keys {
                    existing_table.remove(*key);
                }
                if let Some(features) = existing_table
                    .get_mut("features")
                    .and_then(|value| value.as_table_mut())
                {
                    features.remove("fast_mode");
                }
                toml::to_string_pretty(&existing_table)
                    .map_err(|e| format!("Failed to serialize config: {}", e))?
            }
        } else {
            // Existing config is invalid, use new config directly
            config.config.clone()
        }
    } else {
        // No existing config, use new config directly
        config.config.clone()
    };

    // Write merged config.toml
    fs::write(&config_path, &final_config)
        .map_err(|e| format!("Failed to write config.toml: {}", e))?;

    log::info!("[Codex Provider] Successfully switched to: {}", config.name);

    // Return success message with mode info
    let mode_info = if is_wsl_mode { " (WSL)" } else { "" };
    Ok(format!(
        "Successfully switched to Codex provider: {}{}",
        config.name, mode_info
    ))
}

/// Add a new Codex provider configuration
#[tauri::command]
pub async fn add_codex_provider_config(config: CodexProviderConfig) -> Result<String, String> {
    log::info!("[Codex Provider] Adding provider: {}", config.name);

    let providers_path = get_codex_providers_path()?;

    // Ensure parent directory exists
    if let Some(parent) = providers_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }

    // Load existing providers
    let mut providers: Vec<CodexProviderConfig> = if providers_path.exists() {
        let content = fs::read_to_string(&providers_path)
            .map_err(|e| format!("Failed to read providers.json: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };

    // Check for duplicate ID
    if providers.iter().any(|p| p.id == config.id) {
        return Err(format!("Provider with ID '{}' already exists", config.id));
    }

    providers.push(config.clone());

    // Save providers
    let content = serde_json::to_string_pretty(&providers)
        .map_err(|e| format!("Failed to serialize providers: {}", e))?;
    fs::write(&providers_path, content)
        .map_err(|e| format!("Failed to write providers.json: {}", e))?;

    log::info!(
        "[Codex Provider] Successfully added provider: {}",
        config.name
    );
    Ok(format!(
        "Successfully added Codex provider: {}",
        config.name
    ))
}

/// Update an existing Codex provider configuration
#[tauri::command]
pub async fn update_codex_provider_config(config: CodexProviderConfig) -> Result<String, String> {
    log::info!("[Codex Provider] Updating provider: {}", config.name);

    let providers_path = get_codex_providers_path()?;

    if !providers_path.exists() {
        return Err(format!("Provider with ID '{}' not found", config.id));
    }

    let content = fs::read_to_string(&providers_path)
        .map_err(|e| format!("Failed to read providers.json: {}", e))?;
    let mut providers: Vec<CodexProviderConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse providers.json: {}", e))?;

    // Find and update the provider
    let index = providers
        .iter()
        .position(|p| p.id == config.id)
        .ok_or_else(|| format!("Provider with ID '{}' not found", config.id))?;

    providers[index] = config.clone();

    // Save providers
    let content = serde_json::to_string_pretty(&providers)
        .map_err(|e| format!("Failed to serialize providers: {}", e))?;
    fs::write(&providers_path, content)
        .map_err(|e| format!("Failed to write providers.json: {}", e))?;

    log::info!(
        "[Codex Provider] Successfully updated provider: {}",
        config.name
    );
    Ok(format!(
        "Successfully updated Codex provider: {}",
        config.name
    ))
}

/// Delete a Codex provider configuration
#[tauri::command]
pub async fn delete_codex_provider_config(id: String) -> Result<String, String> {
    log::info!("[Codex Provider] Deleting provider: {}", id);

    let providers_path = get_codex_providers_path()?;

    if !providers_path.exists() {
        return Err(format!("Provider with ID '{}' not found", id));
    }

    let content = fs::read_to_string(&providers_path)
        .map_err(|e| format!("Failed to read providers.json: {}", e))?;
    let mut providers: Vec<CodexProviderConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse providers.json: {}", e))?;

    // Find and remove the provider
    let initial_len = providers.len();
    providers.retain(|p| p.id != id);

    if providers.len() == initial_len {
        return Err(format!("Provider with ID '{}' not found", id));
    }

    // Save providers
    let content = serde_json::to_string_pretty(&providers)
        .map_err(|e| format!("Failed to serialize providers: {}", e))?;
    fs::write(&providers_path, content)
        .map_err(|e| format!("Failed to write providers.json: {}", e))?;

    log::info!("[Codex Provider] Successfully deleted provider: {}", id);
    Ok(format!("Successfully deleted Codex provider: {}", id))
}

/// Reorder Codex provider configurations
#[tauri::command]
pub async fn reorder_codex_provider_configs(ids: Vec<String>) -> Result<String, String> {
    log::info!("[Codex Provider] Reordering providers");

    let providers_path = get_codex_providers_path()?;

    if !providers_path.exists() {
        return Ok("No providers to reorder".to_string());
    }

    let content = fs::read_to_string(&providers_path)
        .map_err(|e| format!("Failed to read providers.json: {}", e))?;
    let providers: Vec<CodexProviderConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse providers.json: {}", e))?;

    // Reorder based on provided IDs
    let mut reordered: Vec<CodexProviderConfig> = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(provider) = providers.iter().find(|p| &p.id == id) {
            reordered.push(provider.clone());
        }
    }

    // Add any providers not in the ids list (keep original order)
    for provider in providers {
        if !ids.contains(&provider.id) {
            reordered.push(provider);
        }
    }

    // Save providers
    let content = serde_json::to_string_pretty(&reordered)
        .map_err(|e| format!("Failed to serialize providers: {}", e))?;
    fs::write(&providers_path, content)
        .map_err(|e| format!("Failed to write providers.json: {}", e))?;

    log::info!("[Codex Provider] Successfully reordered providers");
    Ok("Successfully reordered Codex providers".to_string())
}

/// Clear Codex provider configuration (reset to official)
#[tauri::command]
pub async fn clear_codex_provider_config() -> Result<String, String> {
    log::info!("[Codex Provider] Clearing config");

    let auth_path = get_codex_auth_path()?;
    let config_path = get_codex_config_path()?;

    // Remove auth.json if exists
    if auth_path.exists() {
        fs::remove_file(&auth_path).map_err(|e| format!("Failed to remove auth.json: {}", e))?;
    }

    // Remove config.toml if exists
    if config_path.exists() {
        fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove config.toml: {}", e))?;
    }

    log::info!("[Codex Provider] Successfully cleared config");
    Ok("Successfully cleared Codex configuration. Now using official OpenAI.".to_string())
}

/// Test Codex provider connection
#[tauri::command]
pub async fn test_codex_provider_connection(
    base_url: String,
    api_key: Option<String>,
) -> Result<String, String> {
    log::info!("[Codex Provider] Testing connection to: {}", base_url);

    // Simple connectivity test - just try to reach the endpoint
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let test_url = format!("{}/models", base_url.trim_end_matches('/'));

    let mut request = client.get(&test_url);

    if let Some(key) = api_key {
        request = request.header("Authorization", format!("Bearer {}", key));
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() || status.as_u16() == 401 {
                // 401 means the endpoint exists but auth is required
                Ok(format!(
                    "Connection test successful: endpoint is reachable (status: {})",
                    status
                ))
            } else {
                Ok(format!("Connection test completed with status: {}", status))
            }
        }
        Err(e) => Err(format!("Connection test failed: {}", e)),
    }
}

/// Update Codex reasoning effort level in config.toml
/// This updates the model_reasoning_effort field in ~/.codex/config.toml
/// Supports both Native Windows and WSL modes
#[tauri::command]
pub async fn update_codex_reasoning_level(level: String) -> Result<String, String> {
    log::info!("[Codex] Updating reasoning level to: {}", level);

    // Validate level
    // Note: 'xhigh' is used in config.toml for extra high reasoning level
    let valid_levels = ["low", "medium", "high", "xhigh"];
    if !valid_levels.contains(&level.as_str()) {
        return Err(format!(
            "Invalid reasoning level: {}. Valid values are: low, medium, high, xhigh",
            level
        ));
    }

    let is_wsl_mode = should_use_wsl_config();
    log::info!("[Codex] WSL mode: {}", is_wsl_mode);

    let config_dir = get_codex_config_dir()?;
    let config_path = get_codex_config_path()?;

    log::info!("[Codex] Config directory: {:?}", config_dir);
    log::info!("[Codex] Config path: {:?}", config_path);

    // Ensure config directory exists
    if !config_dir.exists() {
        log::info!("[Codex] Creating config directory: {:?}", config_dir);
        fs::create_dir_all(&config_dir).map_err(|e| {
            format!(
                "Failed to create .codex directory at {:?}: {}",
                config_dir, e
            )
        })?;
    }

    // Read existing config or create new one
    let mut config_table: toml::Table = if config_path.exists() {
        let existing_content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.toml: {}", e))?;
        toml::from_str(&existing_content).unwrap_or_else(|_| toml::Table::new())
    } else {
        toml::Table::new()
    };

    // Update reasoning level
    config_table.insert(
        "model_reasoning_effort".to_string(),
        toml::Value::String(level.clone()),
    );

    // Write back to config.toml
    let final_config = toml::to_string_pretty(&config_table)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, &final_config)
        .map_err(|e| format!("Failed to write config.toml: {}", e))?;

    log::info!("[Codex] Successfully updated reasoning level to: {}", level);

    let mode_info = if is_wsl_mode { " (WSL)" } else { "" };
    Ok(format!(
        "Successfully updated reasoning level to: {}{}",
        level, mode_info
    ))
}

// ============================================================================
// Multi-Agent Configuration (Experimental)
// ============================================================================

/// Multi-agent feature configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMultiAgentConfig {
    pub enabled: bool,
    pub subagent_model: Option<String>,
    pub subagent_reasoning_effort: Option<String>,
}

/// Get Codex multi-agent configuration from config.toml [features] section
#[tauri::command]
pub async fn get_codex_multi_agent_config() -> Result<CodexMultiAgentConfig, String> {
    log::info!("[Codex] Getting multi-agent configuration");

    let config_path = get_codex_config_path()?;

    if !config_path.exists() {
        return Ok(CodexMultiAgentConfig {
            enabled: false,
            subagent_model: None,
            subagent_reasoning_effort: None,
        });
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config.toml: {}", e))?;
    let config_table: toml::Table = toml::from_str(&content).unwrap_or_else(|_| toml::Table::new());

    let enabled = config_table
        .get("features")
        .and_then(|f| f.as_table())
        .and_then(|t| t.get("multi_agent"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let subagent_model = config_table
        .get("features")
        .and_then(|f| f.as_table())
        .and_then(|t| t.get("subagent_model"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let subagent_reasoning_effort = config_table
        .get("features")
        .and_then(|f| f.as_table())
        .and_then(|t| t.get("subagent_reasoning_effort"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(CodexMultiAgentConfig {
        enabled,
        subagent_model,
        subagent_reasoning_effort,
    })
}

/// Set Codex multi-agent configuration in config.toml [features] section
#[tauri::command]
pub async fn set_codex_multi_agent_config(config: CodexMultiAgentConfig) -> Result<String, String> {
    log::info!(
        "[Codex] Setting multi-agent config: enabled={}",
        config.enabled
    );

    let config_dir = get_codex_config_dir()?;
    let config_path = get_codex_config_path()?;

    // Ensure config directory exists
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create .codex directory: {}", e))?;
    }

    // Read existing config
    let mut config_table: toml::Table = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.toml: {}", e))?;
        toml::from_str(&content).unwrap_or_else(|_| toml::Table::new())
    } else {
        toml::Table::new()
    };

    // Update [features] section
    let features = config_table
        .entry("features".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));

    if let Some(features_table) = features.as_table_mut() {
        features_table.insert(
            "multi_agent".to_string(),
            toml::Value::Boolean(config.enabled),
        );

        if let Some(model) = &config.subagent_model {
            features_table.insert(
                "subagent_model".to_string(),
                toml::Value::String(model.clone()),
            );
        } else {
            features_table.remove("subagent_model");
        }

        if let Some(effort) = &config.subagent_reasoning_effort {
            features_table.insert(
                "subagent_reasoning_effort".to_string(),
                toml::Value::String(effort.clone()),
            );
        } else {
            features_table.remove("subagent_reasoning_effort");
        }
    }

    // Write back
    let final_config = toml::to_string_pretty(&config_table)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, &final_config)
        .map_err(|e| format!("Failed to write config.toml: {}", e))?;

    log::info!("[Codex] Multi-agent config updated successfully");
    Ok(format!(
        "Multi-agent {} successfully",
        if config.enabled {
            "enabled"
        } else {
            "disabled"
        }
    ))
}
