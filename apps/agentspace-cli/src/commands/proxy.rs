//! `agentspace proxy ...` —— 全局出站代理。
//!
//! 对应桌面端的「系统设置 › 网络」。
//!
//! 代理是**全局**的：skill 下载、版本检查、MCP 目录搜索都走它。
//! 配置落在 `~/.agent-compose/settings.json`，桌面端和 CLI 读的是同一份。

use clap::{Args, Subcommand};
use agentspace_core::{proxy, Paths};

use crate::output::{self, Format};

#[derive(Subcommand, Debug)]
pub enum ProxyCmd {
    /// 看当前代理状态
    Get(GetArgs),
    /// 设置代理地址（空串 = 强制直连）
    Set(SetArgs),
    /// 测试某个代理地址通不通
    Test(TestArgs),
    /// 扫本机常见的代理端口
    Scan(ScanArgs),
}

#[derive(Args, Debug)]
pub struct GetArgs {
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
pub struct SetArgs {
    /// 代理地址（如 http://127.0.0.1:7890）；空串 = 强制直连
    url: String,
}

#[derive(Args, Debug)]
pub struct TestArgs {
    /// 代理地址
    url: String,
}

#[derive(Args, Debug)]
pub struct ScanArgs {
    /// 输出格式
    #[arg(long, value_enum, default_value = "text")]
    format: Format,
    /// 输出 JSON（等价于 --format json）
    #[arg(long)]
    json: bool,
}

impl ProxyCmd {
    pub fn run(self, paths: &Paths) -> u8 {
        match self {
            ProxyCmd::Get(args) => get(paths, args),
            ProxyCmd::Set(args) => set(paths, args),
            ProxyCmd::Test(args) => test(args),
            ProxyCmd::Scan(args) => scan(args),
        }
    }
}

fn get(paths: &Paths, args: GetArgs) -> u8 {
    let info = proxy::proxy_get(paths);
    if output::wants_json(args.format, args.json) {
        output::json(&info);
        return 0;
    }
    println!("已保存：{}", info.saved_url.unwrap_or_else(|| "（没配）".into()));
    println!(
        "当前生效：{}",
        info.effective_url.unwrap_or_else(|| "直连".into())
    );
    println!("来源：{}", info.source);
    0
}

fn set(paths: &Paths, args: SetArgs) -> u8 {
    match proxy::proxy_set(paths, args.url.clone()) {
        Ok((info, changed)) => {
            println!(
                "已保存代理：{}",
                info.saved_url.unwrap_or_else(|| "（没配）".into())
            );
            if changed {
                println!("提示：代理地址变了，重启 MCP 代理后才会生效。");
            }
            0
        }
        Err(error) => {
            eprintln!("保存失败：{error}");
            1
        }
    }
}

fn test(args: TestArgs) -> u8 {
    let result = crate::commands::block_on(async move { proxy::proxy_test(args.url).await });
    match result {
        Ok(result) => {
            if result.success {
                println!("代理可用，耗时 {} ms", result.latency_ms);
                0
            } else {
                eprintln!(
                    "代理不通：{}",
                    result.error.unwrap_or_else(|| "未知错误".into())
                );
                1
            }
        }
        Err(error) => {
            eprintln!("测试失败：{error}");
            1
        }
    }
}

fn scan(args: ScanArgs) -> u8 {
    let found = proxy::proxy_scan();
    if output::wants_json(args.format, args.json) {
        output::json(&found);
        return 0;
    }
    if found.is_empty() {
        println!("没扫到本机代理。");
        return 0;
    }
    let rows: Vec<Vec<String>> = found
        .iter()
        .map(|item| vec![item.url.clone(), item.proxy_type.clone()])
        .collect();
    output::table(&["地址", "协议"], &rows);
    0
}
