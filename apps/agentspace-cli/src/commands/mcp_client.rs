//! 跟 MCP sidecar 的 admin API 说话。
//!
//! **为什么 CLI 不自己读 `servers.json`** —— 那是 sidecar 的数据：
//! 它启动时读进内存，之后靠 admin 接口更新。两边都直接读文件会读到不同的状态。
//!
//! 所以 CLI 走 admin API —— 跟桌面端是同一个 API 的两个客户端
//! （桌面端和 CLI 调同一套 REST API，一个道理）。
//!
//! HTTP 客户端是手写的：只跟 `127.0.0.1` 上的代理说话，
//! 不值得为这点需求再引一个依赖（reqwest 已经在依赖里，但它是给外网请求用的，
//! 这里用裸 TCP 更省事 —— 代理只在本地）。

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::Value;

use crate::mcp::{read_endpoint, Endpoint};

/// sidecar 的 admin API 客户端。
pub struct McpClient {
    endpoint: Endpoint,
}

impl McpClient {
    /// 连上正在跑的 sidecar。
    ///
    /// 没在跑就先把它拉起来 —— CLI 是自足的，不该要求用户先开桌面端。
    pub fn attach(_paths: &crate::paths::Paths) -> Result<Self, String> {
        let endpoint = match read_endpoint() {
            Some(endpoint) => endpoint,
            None => crate::mcp::ensure_running()?,
        };
        Ok(Self { endpoint })
    }

    /// server 定义列表。
    pub fn servers(&self) -> Result<Vec<Value>, String> {
        let body = self.request("GET", "/admin/servers", None)?;
        // 返回的是数组，或者 { servers: [...] }
        match body {
            Value::Array(items) => Ok(items),
            Value::Object(mut map) => match map.remove("servers") {
                Some(Value::Array(items)) => Ok(items),
                _ => Err("返回格式不对：既不是数组也没有 servers 字段".to_string()),
            },
            _ => Err("返回格式不对".to_string()),
        }
    }

    /// 覆盖式保存 server 定义。
    ///
    /// sidecar 收的是 `{ servers: [...] }` —— 不是裸数组。
    pub fn save_servers(&self, servers: &[Value]) -> Result<(), String> {
        let payload = serde_json::json!({ "servers": servers });
        let body = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
        self.request_raw("PUT", "/admin/servers", Some(body))?;
        Ok(())
    }

    /// 删一个 server。
    pub fn remove_server(&self, id: &str) -> Result<(), String> {
        let path = format!("/admin/servers/{}", encode_component(id));
        self.request_raw("DELETE", &path, None)?;
        Ok(())
    }

    /// 测试一个 server（真实握手 + 拉工具清单）。
    pub fn test_server(&self, id: &str) -> Result<Value, String> {
        let path = format!("/admin/servers/{}/test", encode_component(id));
        self.request("POST", &path, None)
    }

    /// 连上所有启用的上游。
    pub fn connect_all(&self) -> Result<(), String> {
        self.request("POST", "/admin/servers/connect", None)?;
        Ok(())
    }

    /// 探测一个**还没保存**的 server 定义。
    pub fn probe(&self, server: &Value) -> Result<Value, String> {
        let body = serde_json::to_vec(server).map_err(|e| e.to_string())?;
        let raw = self.request_raw("POST", "/admin/servers/probe", Some(body))?;
        serde_json::from_str(&raw).map_err(|e| format!("返回的不是 JSON：{e}"))
    }

    /// 对外的暴露配置。
    pub fn exposure(&self) -> Result<Value, String> {
        self.request("GET", "/admin/exposure", None)
    }

    /// 设置对外暴露的配置。
    ///
    /// sidecar 收的是 `{ exposure: {...} }` —— 不是裸对象。
    pub fn set_exposure(&self, exposure: &Value) -> Result<(), String> {
        let payload = serde_json::json!({ "exposure": exposure });
        let body = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
        self.request_raw("PUT", "/admin/exposure", Some(body))?;
        Ok(())
    }

    /// 刷新访问令牌。
    pub fn refresh_token(&self) -> Result<String, String> {
        let value = self.request("POST", "/admin/token", None)?;
        Ok(value
            .get("token")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string())
    }

    /// 代理的整体状态（含每个上游的工具清单）。
    pub fn status(&self) -> Result<Value, String> {
        self.request("GET", "/admin/status", None)
    }

    fn request(&self, method: &str, path: &str, body: Option<Vec<u8>>) -> Result<Value, String> {
        let raw = self.request_raw(method, path, body)?;
        serde_json::from_str(&raw).map_err(|e| format!("返回的不是 JSON：{e}"))
    }

    /// 发一个请求，返回响应体。
    fn request_raw(&self, method: &str, path: &str, body: Option<Vec<u8>>) -> Result<String, String> {
        let addr = SocketAddr::from(([127, 0, 0, 1], self.endpoint.port));
        let timeout = Duration::from_secs(30);
        let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
            return Err(format!(
                "连不上代理（127.0.0.1:{}）",
                self.endpoint.port
            ));
        };
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));

        let payload = body.unwrap_or_default();
        let mut request = String::new();
        request.push_str(&format!("{method} {path} HTTP/1.1\r\n"));
        request.push_str(&format!("Host: 127.0.0.1:{}\r\n", self.endpoint.port));
        request.push_str(&format!("Authorization: Bearer {}\r\n", self.endpoint.token));
        request.push_str("Content-Type: application/json\r\n");
        request.push_str(&format!("Content-Length: {}\r\n", payload.len()));
        request.push_str("Connection: close\r\n");
        request.push_str("\r\n");
        if stream.write_all(request.as_bytes()).is_err() {
            return Err("请求写不出去".to_string());
        }
        if !payload.is_empty() && stream.write_all(&payload).is_err() {
            return Err("请求体写不出去".to_string());
        }

        // 读响应：先读头，按 Content-Length 取 body。
        // 不能直接 read_to_end —— 服务端会保持连接（keep-alive），
        // 读到 EOF 要等到超时，白等一轮。
        let mut raw = Vec::new();
        let mut chunk = [0u8; 4096];
        let header_end = loop {
            if let Some(index) = find_header_end(&raw) {
                break index;
            }
            let read = stream.read(&mut chunk).map_err(|_| "读响应失败".to_string())?;
            if read == 0 {
                return Err("响应不完整".to_string());
            }
            raw.extend_from_slice(&chunk[..read]);
            if raw.len() > 8 * 1024 * 1024 {
                return Err("响应太大".to_string());
            }
        };
        let header = String::from_utf8_lossy(&raw[..header_end]).into_owned();
        let status = header
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse::<u16>().ok())
            .unwrap_or(0);
        let content_length = header
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.trim().eq_ignore_ascii_case("content-length") {
                    value.trim().parse::<usize>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0);

        let mut body = raw[header_end + 4..].to_vec();
        while body.len() < content_length {
            let read = stream.read(&mut chunk).map_err(|_| "读响应失败".to_string())?;
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read]);
        }
        let text = String::from_utf8_lossy(&body).into_owned();
        if status >= 400 {
            return Err(format!("HTTP {status}：{text}"));
        }
        Ok(text)
    }
}

/// 找 HTTP 头结束的位置（`\r\n\r\n`）
fn find_header_end(raw: &[u8]) -> Option<usize> {
    raw.windows(4).position(|window| window == b"\r\n\r\n")
}

/// 极简 percent-encoding：只放行字母数字和 `-` `_` `.` `~`。
fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
