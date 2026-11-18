//! 导航守卫 —— 不让 webview 像浏览器一样跑起来。
//!
//! # 为什么需要
//!
//! Tauri 的 webview 默认**允许任意导航**：点应用里的链接（发布说明、仓库地址、
//! 文档里的外链），整个窗口会被导航到那个网站 —— 应用就此变成浏览器，
//! 顶栏、侧边栏全没了，用户看着像应用崩了。
//!
//! 底层原因是 wry：只有显式装了导航处理器，`WebView2` 才会挂
//! `NavigationStarting` 事件；不挂就完全不管，导航照走。
//!
//! # 做法
//!
//! 注册一个插件，用 `on_navigation` 钩子拦每一次导航：
//!
//! - **应用自己的地址** → 放行
//! - **外部 http/https** → 取消导航，交给系统默认浏览器打开
//!   （链接还是能用，只是不会把应用带走）
//! - **其它协议**（`file:` / 任意自定义协议）→ 直接取消
//!
//! # 顺带关掉的浏览器特性
//!
//! | 特性 | 状态 |
//! |---|---|
//! | 浏览器扩展（WebView2 `AreBrowserExtensionsEnabled`） | 关 |
//! | Ctrl+滚轮缩放（`IsZoomControlEnabled`） | 关 |
//! | 外部导航把应用带走 | 关（本文档） |
//!
//! 前两项是 Tauri 的 `WindowConfig` 字段（`browserExtensionsEnabled` /
//! `zoomHotkeysEnabled`），默认就是关的 —— 这里显式写进配置，是为了让
//! 「关掉了」这件事在配置里看得见，而不是靠默认值。

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Runtime, Url, Webview};

/// 应用自己的 host（生产环境）。
///
/// Windows 上 Tauri 用的是 `http://tauri.localhost`（Linux/macOS 是 `tauri://localhost`）。
const APP_HOSTS: &[&str] = &["tauri.localhost", "localhost"];

/// 判断一个地址是不是应用自己的。
///
/// 两种情形算「自己的」：
/// 1. host 是 `tauri.localhost` / `localhost` —— 生产环境
/// 2. 跟**当前页面同源** —— 开发环境（`http://localhost:5176`）
///
/// 用「同源」而不是写死开发地址：开发端口写在 `tauri.conf.json` 的 `devUrl` 里，
/// 改了端口这里不用跟着改。
fn is_app_url<R: Runtime>(webview: &Webview<R>, url: &Url) -> bool {
    let host = match url.host_str() {
        Some(host) => host,
        None => return false,
    };
    if APP_HOSTS.contains(&host) {
        return true;
    }
    // 同源比较：scheme + host + port 都一样
    match webview.url() {
        Ok(current) => current.origin() == url.origin(),
        Err(_) => false,
    }
}

/// 用系统默认浏览器打开一个网址。
///
/// 已经在 `lib.rs` 的 `mcp_open_url` 里有一份同样的实现 —— 那份是 Tauri 命令
/// （前端调用），这份是导航守卫内部用的。两边都需要「不经 cmd」地传 URL：
/// 授权地址里带一长串查询参数，cmd 把 `&` 当命令分隔符会把 URL 截断。
#[cfg(windows)]
fn open_in_system_browser(url: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const DETACHED_PROCESS: u32 = 0x0000_0008;
    let mut cmd = Command::new("rundll32");
    cmd.arg("url.dll,FileProtocolHandler")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(DETACHED_PROCESS);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("打开浏览器失败：{e}"))
}

#[cfg(not(windows))]
fn open_in_system_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开浏览器失败：{e}"))
}

/// 导航守卫插件。
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("navigation-guard")
        .on_navigation(|webview: &Webview<R>, url: &Url| {
            // 应用自己的地址 —— 放行
            if is_app_url(webview, url) {
                return true;
            }
            // 外部 http/https —— 交给系统浏览器，不把应用带走
            if url.scheme() == "http" || url.scheme() == "https" {
                if let Err(error) = open_in_system_browser(url.as_str()) {
                    eprintln!("导航守卫：打开系统浏览器失败 —— {error}");
                }
                return false;
            }
            // 其它协议（file: / 自定义协议）—— 一律拦掉
            false
        })
        .build()
}
