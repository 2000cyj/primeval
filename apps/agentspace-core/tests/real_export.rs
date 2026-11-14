//! 拿真实数据目录跑一遍导出 —— 只读，不改用户任何东西。
//!
//! 默认不跑（`#[ignore]`）：它依赖本机有 `~/.agent-compose`。
//! 手动跑：`cargo test --offline --test real_export -- --ignored --nocapture`

use agentspace_core::backup::{self, ExportSelection, SourceKind};
use agentspace_core::paths::Paths;

#[test]
#[ignore]
fn real_data_export() {
    let paths = Paths::from_env();
    println!("数据目录：{}", paths.root().display());

    let inv = backup::inventory(&paths, &[]);
    println!("智能体 {} 个", inv.agents.len());
    for a in &inv.agents {
        println!(
            "  {} —— {} 个 skill / {} 个 mcp / {} 个扩展",
            a.name,
            a.skills.len(),
            a.mcp_servers.len(),
            a.extensions.len()
        );
    }
    println!(
        "skill {} 个（远程 {} / 本地 {}）",
        inv.skills.len(),
        inv.skills.iter().filter(|s| s.kind == SourceKind::Remote).count(),
        inv.skills.iter().filter(|s| s.kind == SourceKind::Local).count()
    );
    for s in &inv.skills {
        let tag = if s.kind == SourceKind::Remote { "远程" } else { "本地" };
        println!("  [{tag}] {} —— {}", s.name, s.source_label);
    }
    println!("扩展 {} 个", inv.extensions.len());
    for e in &inv.extensions {
        println!("  [{}] {} —— {}", e.source, e.name, e.source_label);
    }

    // 真的导一次
    let out = std::env::temp_dir().join("agentspace-real-export.zip");
    let selection = ExportSelection {
        agent_ids: inv.agents.iter().map(|a| a.id.clone()).collect(),
        skill_names: inv.skills.iter().map(|s| s.name.clone()).collect(),
        mcp_server_ids: Vec::new(),
        extension_names: inv
            .extensions
            .iter()
            .filter(|e| e.kind == SourceKind::Local)
            .map(|e| e.name.clone())
            .collect(),
    };
    let result = backup::export(&paths, &[], &selection, &out).unwrap();
    println!(
        "导出完成：{} （{} 字节）",
        result.zip_path,
        std::fs::metadata(&out).unwrap().len()
    );
    println!("  条数：{:?}", result.counts);

    // 校验：清单在里面且能解析
    let report = backup::inspect(&paths, &[], &out).unwrap();
    println!(
        "  清单解析：{} 个 agent / {} 个 skill / {} 个 mcp / {} 个扩展",
        report.summary.agents, report.summary.skills, report.summary.mcp_servers, report.summary.extensions
    );
    // 本机已经有这些数据 → 全部都算冲突，这是对的
    assert!(report.conflicts.len() > 0, "本机已有数据，应该报冲突");
    println!("✅ 冲突检出 {} 条", report.conflicts.len());

    let _ = std::fs::remove_file(&out);
}
