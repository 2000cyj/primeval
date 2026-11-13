//! `agentspace run <名称>` —— 准备目录并拉起智能体。
//!
//! 流程：
//! 1. 按名字找到智能体（`~/.agent-compose/agents/<id>/agent.json`）
//! 2. 看智能体数据里的 `runtime` 字段，用工厂造出对应的运行时对象
//! 3. 检查那个 agent 装没装（没装 → 警告 + 给安装命令，不自动装）
//! 4. 把智能体的能力落到当前目录：skill / 指令 / MCP / 扩展
//! 5. 启动它，终端整个交给它；它退出我们也退出，退出码透传

use agentspace_core::agent::{self, CreatedAgent};
use agentspace_core::Paths;

use crate::prepare;
use crate::runtime;

/// 准备目录并启动智能体。返回退出码。
pub fn run(paths: &Paths, name: &str, agent_args: &[String]) -> u8 {
    match run_agent(paths, name, agent_args) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("{error}");
            3
        }
    }
}

fn run_agent(paths: &Paths, name: &str, agent_args: &[String]) -> Result<u8, String> {
    // 1. 找智能体
    let matches = agent::find_by_name(paths, name);
    if matches.is_empty() {
        let available: Vec<String> = agent::list(paths)
            .into_iter()
            .map(|item| item.name.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
        let mut message = format!("找不到智能体：{name}");
        if available.is_empty() {
            message.push_str("\n（还没有任何智能体 —— 在 AgentSpace 桌面端新建一个）");
        } else {
            message.push_str("\n可用的智能体：");
            for item in available {
                message.push_str(&format!("\n  - {item}"));
            }
        }
        return Err(message);
    }
    if matches.len() > 1 {
        let mut message = format!("有多个智能体叫「{name}」：");
        for item in &matches {
            message.push_str(&format!("\n  - {}（{}）", item.name, item.id));
        }
        return Err(message);
    }
    let agent: CreatedAgent = matches.into_iter().next().expect("刚确认过有一个");

    // 2. 这个智能体跑在哪个 agent 上？
    //    数据里写着（桌面端写下的），不是我们猜的 —— 猜错了会拉起错的程序。
    let runtime_id = if agent.runtime.trim().is_empty() {
        "pi".to_string()
    } else {
        agent.runtime.trim().to_string()
    };

    // 3. 工厂：按 runtime 字段造出对应的运行时对象
    let Some(runtime) = runtime::create(&runtime_id) else {
        eprintln!(
            "智能体「{}」跑在 {} 上，这个版本的 agentspace 不支持这个 agent。",
            agent.name.trim(),
            runtime_id
        );
        eprintln!();
        eprintln!("当前支持：");
        for (id, label) in runtime::supported() {
            eprintln!("  - {label}（{id}）");
        }
        return Ok(3);
    };

    // 4. 那个 agent 装没装
    if !runtime.is_installed() {
        eprintln!(
            "找不到 {} —— 智能体「{}」要跑在 {} 上。",
            runtime.label(),
            agent.name.trim(),
            runtime.label()
        );
        eprintln!();
        eprintln!("请先安装：");
        eprintln!("  {}", runtime.install_hint());
        eprintln!();
        eprintln!("装好后重跑：agentspace run {}", agent.name.trim());
        return Ok(2);
    }

    // 5. 准备目录
    let cwd = std::env::current_dir().map_err(|e| format!("拿不到当前目录：{e}"))?;
    prepare::land(runtime.as_ref(), &agent, &cwd, paths);

    // 6. 拉起它
    //    启动前的准备（写信任名单之类）由运行时自己负责。
    runtime.before_launch(&cwd);
    let code = runtime.launch(&cwd, agent_args).unwrap_or(1);
    Ok(code.clamp(0, 255) as u8)
}
