//! CLI 的各个命令组。

pub mod agent;
pub mod mcp;
pub mod mcp_client;
pub mod proxy;
pub mod run;
pub mod skill;
pub mod tool;

/// 在同步函数里跑一个 future。
///
/// CLI 整体是同步的（终端程序，命令一个个来），但有几个操作是 async：
/// 刷新 skill、URL 导入、查 registry 版本、测代理。
///
/// 不为此把整个 CLI 改成异步 —— 用一个 tokio 运行时把它们跑完就行。
pub fn block_on<F: std::future::Future>(future: F) -> F::Output {
    // 运行时创建一次就够 —— tokio 的 Runtime 复用同一个线程池。
    static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    let runtime = RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .expect("建 tokio 运行时失败")
    });
    runtime.block_on(future)
}
