//! `agentspace install` / `agentspace update` —— 把智能体装进当前目录。
//!
//! 两个命令都只做准备，**不拉起 agent** —— 跟 `run` 的区别就在这。
//! 装完想跑，`agentspace run <名称>` 即可。
//!
//! # install 与 update 的差别
//!
//! | 情况 | `install` | `update` |
//! | --- | --- | --- |
//! | 目录是空的 | 直接装 | 问「没装过，要装吗？」 |
//! | 目录里已经装过 | 问「是否覆盖安装？」 | 直接覆盖，不问 |
//! | 装的是另一个智能体 | 问「是否覆盖安装？」 | 问「要用 B 替掉 A 吗？」 |
//!
//! 「名称匹配不上」指的是：当前目录落地的是智能体 A，你要更新的是 B ——
//! 这不是「更新」，是「换了一个」，所以得问一句。

use agentspace_core::agent::{self, CreatedAgent};
use agentspace_core::Paths;

use crate::prepare::{self, LandPolicy};
use crate::runtime;

/// 退出码：0 成功，1 操作失败，2 参数不对，3 找不到。
const EXIT_OK: u8 = 0;
const EXIT_FAIL: u8 = 1;
const EXIT_INVALID: u8 = 2;
const EXIT_NOT_FOUND: u8 = 3;

/// 装一个智能体到当前目录。
pub fn install(paths: &Paths, name: &str) -> u8 {
    match install_agent(paths, name) {
        Ok(()) => EXIT_OK,
        Err(error) => {
            eprintln!("{error}");
            EXIT_FAIL
        }
    }
}

/// 更新当前目录里的智能体。
pub fn update(paths: &Paths, name: &str) -> u8 {
    match update_agent(paths, name) {
        Ok(()) => EXIT_OK,
        Err(error) => {
            eprintln!("{error}");
            EXIT_FAIL
        }
    }
}

/// 找智能体。找不到就把可用的列出来 —— 用户是照着名字敲的，
/// 差一个字符很常见。
fn pick_agent(paths: &Paths, name: &str) -> Result<CreatedAgent, (String, u8)> {
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
        return Err((message, EXIT_NOT_FOUND));
    }
    if matches.len() > 1 {
        let mut message = format!("有多个智能体叫「{name}」：");
        for item in &matches {
            message.push_str(&format!("\n  - {}（{}）", item.name, item.id));
        }
        return Err((message, EXIT_INVALID));
    }
    Ok(matches.into_iter().next().expect("刚确认过有一个"))
}

/// 装之前要确认的几件事 —— 返回 `None` 表示用户不干了。
///
/// `install`：目录里已经装过 → 问「是否覆盖安装？」
/// `update`：没装过 → 问「要装吗？」；装的是另一个智能体 → 问「要换吗？」
fn confirm_install(
    runtime: &dyn runtime::Runtime,
    agent: &CreatedAgent,
    cwd: &std::path::Path,
    mode: Mode,
) -> Option<agent::CreatedAgent> {
    let state = prepare::read_state(&runtime.state_file(cwd));

    match mode {
        Mode::Install => {
            if let Some(previous) = &state {
                let landed_name = previous.agent_name.trim();
                let landed_name = if landed_name.is_empty() {
                    "（未知）".to_string()
                } else {
                    landed_name.to_string()
                };
                println!(
                    "当前目录已安装「{landed_name}」v{}。",
                    previous.version
                );
                if !prepare::ask_yes_no(&format!(
                    "是否用「{}」v{} 覆盖安装？",
                    agent.name.trim(),
                    agent.version
                )) {
                    return None;
                }
            }
            Some(agent.clone())
        }
        Mode::Update => match &state {
            None => {
                println!("当前目录还没安装任何智能体。");
                if !prepare::ask_yes_no(&format!("要安装「{}」吗？", agent.name.trim())) {
                    return None;
                }
                Some(agent.clone())
            }
            Some(previous) => {
                let landed_name = previous.agent_name.trim();
                if !landed_name.is_empty() && landed_name != agent.name.trim() {
                    // 名字对不上 —— 这不是「更新」，是「换一个」
                    println!(
                        "当前目录装的是「{landed_name}」，你要更新的是「{}」。",
                        agent.name.trim()
                    );
                    if !prepare::ask_yes_no(&format!(
                        "要用「{}」替换掉「{landed_name}」吗？",
                        agent.name.trim()
                    )) {
                        return None;
                    }
                }
                Some(agent.clone())
            }
        },
    }
}

/// 这条命令是「装」还是「更新」—— 问的问题不一样。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Install,
    Update,
}

fn install_agent(paths: &Paths, name: &str) -> Result<(), String> {
    let agent = pick_agent(paths, name).map_err(|(message, _)| message)?;
    let cwd = std::env::current_dir().map_err(|e| format!("拿不到当前目录：{e}"))?;

    let runtime = runtime_for(&agent)?;
    if !runtime.is_installed() {
        return Err(format!(
            "找不到 {} —— 智能体「{}」要跑在 {} 上。\n\n请先安装：\n  {}\n",
            runtime.label(),
            agent.name.trim(),
            runtime.label(),
            runtime.install_hint()
        ));
    }

    let Some(agent) = confirm_install(runtime.as_ref(), &agent, &cwd, Mode::Install)
    else {
        println!("已取消。");
        return Ok(());
    };

    println!("安装「{}」v{} 到 {}", agent.name.trim(), agent.version, cwd.display());
    let state = prepare::land_with(runtime.as_ref(), &agent, &cwd, paths, LandPolicy::Always);
    // 装完就能直接跑 pi —— 项目要在 Pi 的信任名单里
    runtime.before_launch(&cwd);
    report(&state);
    Ok(())
}

fn update_agent(paths: &Paths, name: &str) -> Result<(), String> {
    let agent = pick_agent(paths, name).map_err(|(message, _)| message)?;
    let cwd = std::env::current_dir().map_err(|e| format!("拿不到当前目录：{e}"))?;

    let runtime = runtime_for(&agent)?;
    if !runtime.is_installed() {
        return Err(format!(
            "找不到 {} —— 智能体「{}」要跑在 {} 上。\n\n请先安装：\n  {}\n",
            runtime.label(),
            agent.name.trim(),
            runtime.label(),
            runtime.install_hint()
        ));
    }

    let Some(agent) = confirm_install(runtime.as_ref(), &agent, &cwd, Mode::Update)
    else {
        println!("已取消。");
        return Ok(());
    };

    println!("更新「{}」到 v{}", agent.name.trim(), agent.version);
    let state = prepare::land_with(runtime.as_ref(), &agent, &cwd, paths, LandPolicy::Always);
    runtime.before_launch(&cwd);
    report(&state);
    Ok(())
}

/// 按智能体数据里的 runtime 字段造运行时对象。
fn runtime_for(agent: &CreatedAgent) -> Result<Box<dyn runtime::Runtime>, String> {
    let runtime_id = if agent.runtime.trim().is_empty() {
        "pi".to_string()
    } else {
        agent.runtime.trim().to_string()
    };
    runtime::create(&runtime_id).ok_or_else(|| {
        let mut message = format!(
            "智能体「{}」跑在 {} 上，这个版本的 agentspace 不支持这个 agent。",
            agent.name.trim(),
            runtime_id
        );
        message.push_str("\n当前支持：");
        for (id, label) in runtime::supported() {
            message.push_str(&format!("\n  - {label}（{id}）"));
        }
        message
    })
}

/// 装完打印一下写了什么。
fn report(state: &prepare::LandedState) {
    if state.files.is_empty() {
        println!("没有需要写的文件（配置已经是最新的）。");
        return;
    }
    println!();
    println!("已写入 {} 个文件：", state.files.len());
    for file in &state.files {
        println!("  {file}");
    }
    println!();
    println!("跑起来：agentspace run {}", state.agent_name.trim());
}
