//! 验证「远程 skill 只记链接」这条路径：
//! 导出的包里远程 skill 没有文件，导入时应该重新从仓库拉。
//!
//! 需要网络，会真的 clone 仓库 —— 所以默认不跑。
//! `cargo test --offline --test remote_import -- --ignored --nocapture`

use agentspace_core::backup::{self, ExportSelection, SourceKind};
use agentspace_core::paths::Paths;

fn temp_paths(tag: &str) -> Paths {
    let dir = std::env::temp_dir().join(format!(
        "agentspace-remote-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(dir.join(".agent-compose")).unwrap();
    Paths::new(dir)
}

#[test]
#[ignore]
fn remote_skill_is_reinstalled_from_repo() {
    let source_paths = Paths::from_env();

    // 找一个远程 skill 当样本
    let inv = backup::inventory(&source_paths, &[]);
    let sample = inv
        .skills
        .iter()
        .find(|s| s.kind == SourceKind::Remote && s.source_label.starts_with("github.com/addyosmani"))
        .expect("本机得有远程 skill");
    println!("样本：{} —— {}", sample.name, sample.source_label);

    // 导一份（只导这一个）
    let zip_path = std::env::temp_dir().join("agentspace-remote-sample.zip");
    let selection = ExportSelection {
        skill_names: vec![sample.name.clone()],
        ..Default::default()
    };
    backup::export(&source_paths, &[], &selection, &zip_path).unwrap();

    // 干净环境导入
    let target = temp_paths("target");
    let mut servers = Vec::new();
    let result = backup::import(&target, &mut servers, &zip_path, &[], &[], None).unwrap();
    println!("导入结果：{:?}", result);
    println!("失败：{:?}", result.failures);
    println!("警告：{:?}", result.warnings);

    assert!(
        result.imported.skills > 0,
        "远程 skill 应该被重新拉下来，失败信息：{:?}",
        result.failures
    );
    assert!(target.skills_root().join(&sample.name).join("SKILL.md").is_file());

    let _ = std::fs::remove_dir_all(target.home());
    let _ = std::fs::remove_file(&zip_path);
}
