//! 自动备份与恢复的端到端流程。
//!
//! 跑在临时目录里 —— 不碰用户数据。
//!
//! 覆盖的是 cc-switch 那套机制里最要紧的几条：
//! - 备份先校验后发布，坏包不进备份目录；
//! - 恢复前先给当前数据做安全备份；
//! - 恢复前先校验包，坏包不动现有数据；
//! - 清理时保护正在恢复的备份。

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use agentspace_core::autobackup;
use agentspace_core::paths::Paths;

/// 造一个干净的临时数据目录。
fn temp_paths(tag: &str) -> Paths {
    let dir = std::env::temp_dir().join(format!(
        "agentspace-backup-flow-{tag}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join(".agent-compose")).unwrap();
    Paths::new(dir)
}

/// 往 skills 目录里放一个本地 skill。
fn write_skill(paths: &Paths, name: &str) {
    let dir = paths.root().join("skills").join(name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: 测试用的 skill\n---\n\n正文\n"),
    )
    .unwrap();
}

/// skill 在不在。
fn skill_exists(paths: &Paths, name: &str) -> bool {
    paths.root().join("skills").join(name).join("SKILL.md").is_file()
}

#[test]
fn backup_then_restore_brings_the_skill_back() {
    let paths = temp_paths("restore");
    write_skill(&paths, "备份测试");

    // 备份一次。
    let entry = autobackup::create(&paths, &[]).expect("备份失败");
    assert!(Path::new(&entry.path).is_file(), "备份文件应该存在");

    // 把 skill 删了 —— 模拟「数据被弄丢了」。
    fs::remove_dir_all(paths.root().join("skills").join("备份测试")).unwrap();
    assert!(!skill_exists(&paths, "备份测试"));

    // 恢复。
    let mut servers: Vec<serde_json::Value> = Vec::new();
    let result = autobackup::restore(&paths, &mut servers, &entry.file_name, &[]).expect("恢复失败");
    assert_eq!(result.restored, 1, "应该恢复了 1 个 skill");
    assert!(skill_exists(&paths, "备份测试"), "skill 应该回来了");
    let _ = fs::remove_dir_all(paths.home());
}

#[test]
fn restore_makes_a_safety_backup_first() {
    let paths = temp_paths("safety");
    write_skill(&paths, "备份测试");

    let entry = autobackup::create(&paths, &[]).expect("备份失败");

    // 恢复前把 skill 改个样儿 —— 安全备份里应该还是老的。
    fs::write(
        paths.root().join("skills").join("备份测试").join("SKILL.md"),
        "---\nname: 备份测试\ndescription: 改过的\n---\n\n改过的正文\n",
    )
    .unwrap();

    let mut servers: Vec<serde_json::Value> = Vec::new();
    let result = autobackup::restore(&paths, &mut servers, &entry.file_name, &[]).expect("恢复失败");

    // 恢复前存了一份底子。
    let safety = result.safety_backup.expect("应该返回安全备份的文件名");
    assert!(Path::new(&paths.root().join("backups").join(&safety)).is_file());
    // 备份目录里现在有两份（原来的 + 安全备份）。
    assert_eq!(autobackup::list(&paths).len(), 2);
    let _ = fs::remove_dir_all(paths.home());
}

#[test]
fn restore_refuses_a_corrupt_backup_and_keeps_the_data() {
    let paths = temp_paths("corrupt");
    write_skill(&paths, "备份测试");

    // 造一个「看着像备份、其实是坏的」的文件。
    let dir = autobackup::backups_dir(&paths);
    fs::create_dir_all(&dir).unwrap();
    let bad_name = "agentspace-20231114-221320.zip";
    fs::write(dir.join(bad_name), b"this is not a zip file").unwrap();

    // 恢复 —— 应该失败。
    let mut servers: Vec<serde_json::Value> = Vec::new();
    let result = autobackup::restore(&paths, &mut servers, bad_name, &[]);
    let error = result.expect_err("坏包应该恢复失败");
    assert!(
        error.contains("zip") || error.contains("清单") || error.contains("manifest"),
        "错误信息应该说清楚是包坏了，实际是：{error}"
    );

    // 现有数据一点没动。
    assert!(skill_exists(&paths, "备份测试"));
    // 也没给它做安全备份 —— 没恢复就不该有。
    assert_eq!(autobackup::list(&paths).len(), 1);
    let _ = fs::remove_dir_all(paths.home());
}

#[test]
fn an_empty_dataset_is_still_a_valid_backup() {
    let paths = temp_paths("empty-ok");
    // 什么都没放 —— 空数据集也得能备份、也能恢复。
    let entry = autobackup::create(&paths, &[]).expect("空数据也应该能备份");
    assert!(Path::new(&entry.path).is_file());
    let mut servers: Vec<serde_json::Value> = Vec::new();
    let result = autobackup::restore(&paths, &mut servers, &entry.file_name, &[]);
    assert!(result.is_ok(), "空数据备份应该能恢复");
    let _ = fs::remove_dir_all(paths.home());
}

#[test]
fn prune_keeps_the_backup_being_restored() {
    let paths = temp_paths("prune-restore");
    let dir = autobackup::backups_dir(&paths);
    fs::create_dir_all(&dir).unwrap();
    for (index, name) in [
        "agentspace-20231114-221320.zip",
        "agentspace-20231115-221320.zip",
        "agentspace-20231116-221320.zip",
    ]
    .iter()
    .enumerate()
    {
        let path = dir.join(name);
        fs::write(&path, b"x").unwrap();
        // 明确的时间戳 —— 否则排序靠运气
        let file = fs::File::options().write(true).open(&path).unwrap();
        let times = fs::FileTimes::new().set_modified(
            UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000 + index as u64),
        );
        file.set_times(times).unwrap();
    }

    // 保留 1 个，但最旧的那个正在被恢复 —— 不能删。
    let protected = vec!["agentspace-20231114-221320.zip".to_string()];
    let removed = autobackup::prune(&paths, 1, &protected).unwrap();
    assert_eq!(removed, 1);
    assert!(dir.join("agentspace-20231114-221320.zip").exists());
    // 宁可超出保留数，也不删掉正在恢复的那份。
    assert_eq!(autobackup::list(&paths).len(), 2);
    let _ = fs::remove_dir_all(paths.home());
}

#[test]
fn auto_backup_creates_one_when_the_latest_is_stale() {
    let paths = temp_paths("auto");
    write_skill(&paths, "备份测试");

    // 造一个「很久以前」的备份 —— 时间戳写在文件名里，改不了时间，
    // 所以直接把它的修改时间设老。
    let dir = autobackup::backups_dir(&paths);
    fs::create_dir_all(&dir).unwrap();
    let old = dir.join("agentspace-20200101-000000.zip");
    fs::write(&old, b"x").unwrap();
    let file = fs::File::options().write(true).open(&old).unwrap();
    let times = fs::FileTimes::new()
        .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000));
    file.set_times(times).unwrap();

    // 间隔 6 小时 —— 那个备份早超了。
    agentspace_core::settings::update(&paths, |settings| {
        settings.auto_backup_interval_hours = 6;
    })
    .unwrap();

    assert!(autobackup::auto_backup_if_due(&paths, &[]).unwrap());
    // 新的备份建出来了。
    assert_eq!(autobackup::list(&paths).len(), 2);
    let _ = fs::remove_dir_all(paths.home());
}

#[test]
fn auto_backup_does_not_stack_up_on_repeated_checks() {
    let paths = temp_paths("auto-once");
    write_skill(&paths, "备份测试");

    // 一次都没备份过 —— 该建一个。
    assert!(autobackup::auto_backup_if_due(&paths, &[]).unwrap());
    assert_eq!(autobackup::list(&paths).len(), 1);

    // 紧接着再检查 —— 最新的刚建好，不该再备。
    assert!(!autobackup::auto_backup_if_due(&paths, &[]).unwrap());
    assert_eq!(autobackup::list(&paths).len(), 1);
    let _ = fs::remove_dir_all(paths.home());
}
