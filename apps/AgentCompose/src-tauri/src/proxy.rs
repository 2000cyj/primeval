//! 全局出站代理 —— **Tauri 薄封装**。
//!
//! 实现在共享 crate `agentspace-core` 里（`agentspace_core::proxy`）。
//! CLI 也用同一份 —— 代理是全局的，配置落在 `~/.agent-compose/settings.json`，
//! 两边读同一份文件。

use tauri::AppHandle;

pub use agentspace_core::proxy::{DetectedProxy, ProxyInfo, ProxyTestResult};

use crate::paths;

/// 读代理状态。
#[tauri::command]
pub fn proxy_get(app: AppHandle) -> ProxyInfo {
    agentspace_core::proxy::proxy_get(&paths::of(&app))
}

/// 保存代理地址。传空串 = 强制直连。
///
/// 代理是按环境变量传给 sidecar 的，只在它启动时生效 → 地址变了得重启它。
/// sidecar 是独立进程，agent 可能正在用它，别没事就重启 —— 只在真变了才动。
#[tauri::command]
pub fn proxy_set(app: AppHandle, url: String) -> Result<ProxyInfo, String> {
    let paths = paths::of(&app);
    let (info, changed) = agentspace_core::proxy::proxy_set(&paths, url)?;
    if changed {
        crate::stop_sidecar(&app);
    }
    Ok(info)
}

/// 测试代理连通性。
#[tauri::command]
pub async fn proxy_test(url: String) -> Result<ProxyTestResult, String> {
    agentspace_core::proxy::proxy_test(url).await
}

/// 扫本机常见端口上有没有代理在跑。
#[tauri::command]
pub async fn proxy_scan() -> Vec<DetectedProxy> {
    agentspace_core::proxy::proxy_scan()
}
