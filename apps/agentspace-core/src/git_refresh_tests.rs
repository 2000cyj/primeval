//! Git 来源刷新回归：不联网、不触碰真实用户目录。
use crate::{git_source::{self, GitSource}, paths::Paths, skills};
use std::{fs, path::Path, process::Command, time::{SystemTime, UNIX_EPOCH}};

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git").current_dir(dir).args(args).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

#[tokio::test]
async fn refresh_git_skills_and_advance_cached_branch() {
    let home = std::env::temp_dir().join(format!("agentspace-git-refresh-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir_all(&home).unwrap();
    let paths = Paths::new(&home);
    let upstream = home.join("upstream");
    fs::create_dir_all(&upstream).unwrap();
    git(&upstream, &["init", "-b", "master"]);
    git(&upstream, &["config", "user.email", "test@example.com"]);
    git(&upstream, &["config", "user.name", "Test"]);
    for rel in ["", "remote-child", "skills/engineering/nested"] {
        let dir = upstream.join(rel);
        fs::create_dir_all(&dir).unwrap();
        let name = match rel { "" => "remote-root", "remote-child" => "remote-child", _ => "nested" };
        fs::write(dir.join("SKILL.md"), format!("---\nname: {name}\ndescription: initial\n---\nold\n")).unwrap();
    }
    git(&upstream, &["add", "."]);
    git(&upstream, &["commit", "-m", "initial"]);
    let mut source = GitSource { repo: "example.com/owner/repo".into(), reference: Some("master".into()) };
    let cache = git_source::git_cache_dir(&paths, &source);
    fs::create_dir_all(cache.parent().unwrap()).unwrap();
    git(&home, &["clone", upstream.to_str().unwrap(), cache.to_str().unwrap()]);
    // 缓存建好后上游前进，覆盖显式分支及默认分支两条刷新路径。
    for (name, rel) in [("remote-root", ""), ("remote-child", "remote-child"), ("nested", "skills/engineering/nested")] {
        fs::write(upstream.join(rel).join("SKILL.md"), format!("---\nname: {name}\ndescription: updated\n---\nnew\n")).unwrap();
        let target = paths.skills_root().join(name);
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("SKILL.md"), format!("---\nname: {name}\n---\nold\n")).unwrap();
        fs::write(target.join("stale.txt"), "remove me").unwrap();
        fs::write(target.join(".agent-compose.json"), serde_json::to_vec(&serde_json::json!({"source":"git", "enabled":false, "origin":{"type":"git", "source_url":source.repo, "source_ref":"master"}})).unwrap()).unwrap();
    }
    git(&upstream, &["add", "."]);
    git(&upstream, &["commit", "-m", "update"]);
    for name in ["remote-root", "remote-child", "nested"] {
        let info = skills::skills_refresh(&paths, name.into()).await.unwrap();
        assert!(!info.enabled);
        assert!(info.refreshable);
        let target = paths.skills_root().join(name);
        assert!(fs::read_to_string(target.join("SKILL.md")).unwrap().contains("new"));
        assert!(!target.join("stale.txt").exists());
        let meta: serde_json::Value = serde_json::from_slice(&fs::read(target.join(".agent-compose.json")).unwrap()).unwrap();
        assert_eq!(meta["origin"]["source_ref"], "master");
    }
    fs::write(upstream.join("default.txt"), "default branch updated").unwrap();
    git(&upstream, &["add", "."]);
    git(&upstream, &["commit", "-m", "default update"]);
    source.reference = None;
    git_source::ensure_cloned(&paths, &source).unwrap();
    assert!(cache.join("default.txt").is_file());
    // fetch 失败必须报错，不能用旧缓存伪装更新成功。
    git(&cache, &["remote", "set-url", "origin", home.join("missing").to_str().unwrap()]);
    let before = fs::read(paths.skills_root().join("remote-root/SKILL.md")).unwrap();
    assert!(skills::skills_refresh(&paths, "remote-root".into()).await.is_err());
    assert_eq!(before, fs::read(paths.skills_root().join("remote-root/SKILL.md")).unwrap());
    fs::remove_dir_all(home).unwrap();
}
