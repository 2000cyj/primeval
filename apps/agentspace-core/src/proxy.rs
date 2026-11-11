//! 全局出站代理。
//!
//! 思路抄自 cc-switch（https://github.com/farion1231/cc-switch，MIT）：
//! 用户配一个代理地址，本应用所有出站请求都走它。
//!
//! 落盘位置：`~/.agent-compose/settings.json`
//! - `globalProxyUrl` **缺失** → 未配置：沿用环境变量里的代理（HTTP_PROXY 等）；
//! - `globalProxyUrl` 是**空串** → 强制直连（连环境变量也不看）；
//! - 否则 → 用这个地址。

use crate::paths::Paths;
use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// 设置文件名（`~/.agent-compose/settings.json`）。
const SETTINGS_FILE: &str = "settings.json";

/// 本机常见的代理端口：`(端口, 主要协议, 是否同时支持另一种协议)`。
///
/// mixed 端口（Clash 的 7890 / 7897）两种协议都能用，扫到后两种都给。
const PROXY_PORTS: &[(u16, &str, bool)] = &[
    (7890, "http", true),     // Clash（mixed）
    (7891, "socks5", false),  // Clash SOCKS
    (7897, "http", true),     // Clash Verge
    (1080, "socks5", false),  // 通用 SOCKS5
    (8080, "http", false),    // 通用 HTTP
    (8888, "http", false),    // Charles / Fiddler
    (3128, "http", false),    // Squid
    (10808, "socks5", false), // v2rayN SOCKS
    (10809, "http", false),   // v2rayN HTTP
];

/// 落盘的设置。
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ProxySettings {
    /// 全局代理地址。`None` = 从未设置；`Some("")` = 强制直连。
    global_proxy_url: Option<String>,
}

/// 代理是从哪儿来的。
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProxySource {
    /// 用户在「系统设置 › 网络」里配的。
    Settings,
    /// 环境变量里的代理。
    Env,
    /// 什么都没配。
    Unset,
}

/// 解析结果。
#[derive(Clone, Debug)]
pub struct Resolved {
    /// 实际使用的代理地址；`None` = 直连。
    pub url: Option<String>,
    /// 来源。
    pub source: ProxySource,
}

/// 代理状态（给界面显示）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyInfo {
    /// 用户保存的原始值；`null` = 从未设置。
    pub saved_url: Option<String>,
    /// 当前实际生效的地址；`null` = 直连。
    pub effective_url: Option<String>,
    /// 来源：`settings` / `env` / `unset`。
    pub source: String,
}

/// 代理连通性测试结果。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyTestResult {
    /// 是否连得上。
    pub success: bool,
    /// 往返耗时（毫秒）。
    pub latency_ms: u64,
    /// 失败原因。
    pub error: Option<String>,
}

/// 扫到的本地代理。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedProxy {
    /// 代理地址。
    pub url: String,
    /// 协议：http / socks5。
    pub proxy_type: String,
    /// 端口。
    pub port: u16,
}

/// 设置文件路径（`~/.agent-compose/settings.json`）。
fn settings_path(paths: &Paths) -> PathBuf {
    paths.root().join(SETTINGS_FILE)
}

/// 读设置。文件不存在或坏了都当默认值，别让界面因为一个坏 JSON 打不开。
fn read_settings(paths: &Paths) -> ProxySettings {
    let Ok(raw) = std::fs::read_to_string(settings_path(paths)) else {
        return ProxySettings::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// 写设置。
fn write_settings(paths: &Paths, settings: &ProxySettings) -> Result<(), String> {
    let path = settings_path(paths);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("写入设置失败：{e}"))
}

/// 环境变量里的代理地址。
fn env_proxy() -> Option<String> {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 解析当前该用哪个代理。
pub fn resolve(paths: &Paths) -> Resolved {
    match read_settings(paths).global_proxy_url {
        // 存了值：空串 = 强制直连，否则用它。
        Some(raw) => {
            let trimmed = raw.trim().to_string();
            let url = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            };
            Resolved {
                url,
                source: ProxySource::Settings,
            }
        }
        // 从没配过：看环境变量。
        None => match env_proxy() {
            Some(url) => Resolved {
                url: Some(url),
                source: ProxySource::Env,
            },
            None => Resolved {
                url: None,
                source: ProxySource::Unset,
            },
        },
    }
}

/// 给 reqwest 客户端套上全局代理。
///
/// - 有代理 → 显式挂上（reqwest 默认只读环境变量，用户在界面里配的地址它不认）；
/// - 明确设为直连 → `no_proxy()` 绕开环境变量；
/// - 什么都没配 → 不动 builder（reqwest 自己会读环境变量）。
pub fn apply_to(builder: reqwest::ClientBuilder, paths: &Paths) -> reqwest::ClientBuilder {
    let resolved = resolve(paths);
    match resolved.url {
        Some(url) => match reqwest::Proxy::all(&url) {
            Ok(proxy) => builder.proxy(proxy),
            // 地址不合法：直连，别把请求全打挂。
            Err(_) => builder,
        },
        None if resolved.source == ProxySource::Settings => builder.no_proxy(),
        None => builder,
    }
}

/// 校验代理地址。
fn validate_proxy_url(raw: &str) -> Result<(), String> {
    let parsed = url::Url::parse(raw).map_err(|e| format!("代理地址不合法：{e}"))?;
    if !matches!(
        parsed.scheme(),
        "http" | "https" | "socks4" | "socks4a" | "socks5" | "socks5h"
    ) {
        return Err(format!("不支持的代理协议：{}", parsed.scheme()));
    }
    if parsed.host_str().unwrap_or("").is_empty() {
        return Err("代理地址缺少主机名".to_string());
    }
    Ok(())
}

/// 代理地址里的密码打码，只用于日志与界面回显。
pub fn mask_url(raw: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(raw) else {
        return raw.to_string();
    };
    if parsed.password().is_some() {
        let _ = parsed.set_password(Some("***"));
    }
    parsed.to_string()
}

/// 读代理状态。
pub fn proxy_get(paths: &Paths) -> ProxyInfo {
    let resolved = resolve(paths);
    ProxyInfo {
        saved_url: read_settings(paths).global_proxy_url,
        // 生效地址里的密码打码：界面会直接显示它。
        effective_url: resolved.url.as_deref().map(mask_url),
        source: match resolved.source {
            ProxySource::Settings => "settings",
            ProxySource::Env => "env",
            ProxySource::Unset => "unset",
        }
        .to_string(),
    }
}

/// 保存代理地址。传空串 = 强制直连。
///
/// 返回 `(状态, 生效地址是否变了)` —— 「变了」由调用方决定要不要重启 sidecar
/// （它只在启动时读一次代理环境变量）。
pub fn proxy_set(paths: &Paths, url: String) -> Result<(ProxyInfo, bool), String> {
    let trimmed = url.trim();
    if !trimmed.is_empty() {
        validate_proxy_url(trimmed)?;
    }

    let before = resolve(paths).url;

    let mut settings = read_settings(paths);
    settings.global_proxy_url = Some(trimmed.to_string());
    write_settings(paths, &settings)?;

    // 代理是按环境变量传给 sidecar 的，只在它启动时生效 → 变了得重启它。
    // sidecar 是独立进程，agent 可能正在用它，别没事就重启。
    // core 只管改设置；「要不要重启 sidecar」由调用方决定（桌面端知道 sidecar 在哪）。
    let changed = before != resolve(paths).url;

    Ok((proxy_get(paths), changed))
}

/// 测试代理连通性。
pub async fn proxy_test(url: String) -> Result<ProxyTestResult, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("代理地址为空".to_string());
    }
    validate_proxy_url(trimmed)?;

    let proxy = reqwest::Proxy::all(trimmed).map_err(|e| format!("代理地址不合法：{e}"))?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // 多个目标，任一成功即认为代理可用 —— 不同代理对不同域名的连通性差别很大。
    const TARGETS: &[&str] = &[
        "https://registry.npmjs.org/",
        "https://www.baidu.com/",
        "https://www.google.com/",
        "https://api.anthropic.com/",
    ];

    let start = Instant::now();
    let mut last_error = String::from("所有测试目标都失败");
    for target in TARGETS {
        match client.get(*target).send().await {
            Ok(response) => {
                let status = response.status();
                // 407 = 代理要认证：地址对、密码错。
                if status == reqwest::StatusCode::PROXY_AUTHENTICATION_REQUIRED {
                    return Ok(ProxyTestResult {
                        success: false,
                        latency_ms: start.elapsed().as_millis() as u64,
                        error: Some("代理要求认证，用户名或密码不对".to_string()),
                    });
                }
                // 能拿到 HTTP 响应就说明隧道通了（状态码是目标站给的，不是代理给的）。
                return Ok(ProxyTestResult {
                    success: true,
                    latency_ms: start.elapsed().as_millis() as u64,
                    error: None,
                });
            }
            Err(error) => last_error = error.to_string(),
        }
    }

    Ok(ProxyTestResult {
        success: false,
        latency_ms: start.elapsed().as_millis() as u64,
        error: Some(last_error),
    })
}

/// 扫本机常见端口上有没有代理在跑。
pub fn proxy_scan() -> Vec<DetectedProxy> {
    // 扫端口要等连接超时 —— 调用方自己决定放不放后台线程。
    {
        let mut found = Vec::new();
        for &(port, primary_type, is_mixed) in PROXY_PORTS {
            let addr = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
            if TcpStream::connect_timeout(&addr.into(), Duration::from_millis(120)).is_ok() {
                found.push(DetectedProxy {
                    url: format!("{primary_type}://127.0.0.1:{port}"),
                    proxy_type: primary_type.to_string(),
                    port,
                });
                if is_mixed {
                    let alt = if primary_type == "http" { "socks5" } else { "http" };
                    found.push(DetectedProxy {
                        url: format!("{alt}://127.0.0.1:{port}"),
                        proxy_type: alt.to_string(),
                        port,
                    });
                }
            }
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_and_socks_proxies() {
        assert!(validate_proxy_url("http://127.0.0.1:7890").is_ok());
        assert!(validate_proxy_url("https://127.0.0.1:7890").is_ok());
        assert!(validate_proxy_url("socks5://127.0.0.1:1080").is_ok());
        assert!(validate_proxy_url("socks5h://127.0.0.1:1080").is_ok());
    }

    #[test]
    fn rejects_broken_or_unsupported_proxies() {
        // 少了协议
        assert!(validate_proxy_url("127.0.0.1:7890").is_err());
        // 协议不支持
        assert!(validate_proxy_url("ftp://127.0.0.1:21").is_err());
    }

    #[test]
    fn reqwest_accepts_socks_proxy() {
        // socks 支持得靠 reqwest 的 socks feature，少了它这里会报「不支持的协议」。
        assert!(reqwest::Proxy::all("socks5://127.0.0.1:1080").is_ok());
    }

    #[test]
    fn masks_password() {
        let masked = mask_url("http://user:secret@127.0.0.1:7890");
        assert!(masked.contains("***"), "密码应被打码：{masked}");
        assert!(!masked.contains("secret"), "密码不能漏出去：{masked}");
    }
}
