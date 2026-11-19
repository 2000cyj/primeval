//! 智能体的「导出 → 导入」往返审计。
//!
//! 回答一个问题：**数据管理导出的包，导入到另一台机器后，
//! 智能体还能不能原样用？**
//!
//! 具体就是：智能体引用了一堆东西（skill / MCP server / Pi 扩展 / wiki 页面），
//! 导出导入之后，这些引用还指不指得到实际存在的东西。
//!
//! 引用指空了 = 智能体在别的机器上是个空壳 —— 界面看着配好了，一跑就报错。
//!
//! 跑：`cargo test --offline --test agent_roundtrip`

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use agentspace_core::agent::{self, CreatedAgent};
use agentspace_core::backup::{self, ExportSelection};
use agentspace_core::paths::Paths;
use agentspace_core::wiki;

/// 造一个干净的临时数据目录。
fn temp_paths(tag: &str) -> Paths {
    let dir = std::env::temp_dir().join(format!(
        "agentspace-roundtrip-{tag}-{}-{}",
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
    let dir = paths.skills_root().join(name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: 本地 skill\n---\n\n正文\n"),
    )
    .unwrap();
}

/// 放一个自定义扩展（npm 扩展要联网装，测不了）。
fn write_extension(paths: &Paths, name: &str) {
    let dir = agentspace_core::extensions::library_dir(paths)
        .join("custom")
        .join(name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("index.ts"), "export default {}\n").unwrap();
    fs::write(dir.join("package.json"), "{\"name\":\"x\"}\n").unwrap();
}

/// 造一个「本地 MCP server」定义。
fn mcp_servers() -> Vec<serde_json::Value> {
    vec![serde_json::json!({
        "id": "idea",
        "name": "IDEA",
        "command": "idea-mcp",
        "args": [],
    })]
}

/// 源环境：智能体 + 它绑的所有东西。
fn build_source(paths: &Paths) -> CreatedAgent {
    write_skill(paths, "java-rules");
    write_skill(paths, "vue");
    write_extension(paths, "my-bridge");

    // wiki 页面：入口 + 子页（智能体绑入口，子树自动继承）
    wiki::create_page(paths, "运维手册", None).unwrap();
    wiki::save_page(
        paths,
        "运维手册",
        "运维手册",
        "# 运维\n\n部署步骤。\n",
        &["运维".to_string()],
        None,
    )
    .unwrap();

    let agent = CreatedAgent {
        id: "agent-test-0001".to_string(),
        name: "全栈开发工程师".to_string(),
        description: "Java 8 后端 + Vue 3 前端".to_string(),
        instruction: "# 全栈开发工程师\n\n你是后端前端一起干的全栈工程师。\n".to_string(),
        skills: vec!["skills/java-rules".to_string(), "skills/vue".to_string()],
        mcp_servers: vec!["mcp/servers.json#idea".to_string()],
        extensions: vec!["extensions/custom/my-bridge".to_string()],
        wiki_pages: vec!["wiki/运维手册".to_string()],
        runtime: "pi".to_string(),
        version: 7,
        created_at: 1_700_000_000_000,
    };
    agent::save(paths, &agent).unwrap();
    agent
}

#[test]
fn agent_round_trip_keeps_every_reference_resolvable() {
    let source = temp_paths("source");
    let original = build_source(&source);

    // ── 导出 ─────────────────────────────────────────────
    let zip_path = std::env::temp_dir().join("agentspace-roundtrip.zip");
    let _ = fs::remove_file(&zip_path);
    let selection = ExportSelection {
        agent_ids: vec![original.id.clone()],
        skill_names: vec!["java-rules".to_string(), "vue".to_string()],
        mcp_server_ids: vec!["idea".to_string()],
        extension_names: vec!["my-bridge".to_string()],
        wiki_slugs: vec!["运维手册".to_string()],
    };
    let servers = mcp_servers();
    backup::export(&source, &servers, &selection, &zip_path).unwrap();

    // ── 导入到干净环境 ───────────────────────────────────
    let target = temp_paths("target");
    let mut target_servers: Vec<serde_json::Value> = Vec::new();
    let result = backup::import(&target, &mut target_servers, &zip_path, &[], &[], None).unwrap();
    println!("导入结果：{:?}", result.imported);
    println!("失败：{:?}", result.failures);
    assert!(result.failures.is_empty(), "导入不该有失败：{:?}", result.failures);

    // ── 智能体回来了吗 ───────────────────────────────────
    let restored_list = agent::list(&target);
    assert_eq!(restored_list.len(), 1, "应该恢复出 1 个智能体");
    let restored = &restored_list[0];
    assert_eq!(restored.id, original.id);
    assert_eq!(restored.name, original.name);
    assert_eq!(restored.description, original.description);
    assert_eq!(restored.instruction, original.instruction, "指令正文要回来");

    // ── 引用还指得到东西吗 ───────────────────────────────
    // 这一段是重点：智能体在别的机器上能不能用，全看这些引用还指不指得到。
    assert_eq!(
        restored.skills, original.skills,
        "绑定的 skill 列表要原样回来"
    );
    assert_eq!(
        restored.mcp_servers, original.mcp_servers,
        "绑定的 MCP server 要原样回来"
    );
    assert_eq!(
        restored.extensions, original.extensions,
        "绑定的 Pi 扩展要原样回来"
    );
    assert_eq!(
        restored.wiki_pages, original.wiki_pages,
        "绑定的 wiki 页面要原样回来"
    );

    for skill in &restored.skills {
        let name = skill.rsplit('/').next().unwrap();
        assert!(
            target.skills_root().join(name).join("SKILL.md").is_file(),
            "引用的 skill 没落地：{skill}"
        );
    }
    for ext in &restored.extensions {
        // `extensions/<子目录>/<名字>`
        let parts: Vec<&str> = ext.split('/').collect();
        assert_eq!(parts.len(), 3, "扩展引用的格式不对：{ext}");
        let dir = agentspace_core::extensions::library_dir(&target)
            .join(parts[1])
            .join(parts[2]);
        assert!(dir.is_dir(), "引用的扩展没落地：{ext} → {}", dir.display());
    }
    for page in &restored.wiki_pages {
        let slug = page.rsplit('/').next().unwrap();
        assert!(
            wiki::read_page(&target, slug).is_ok(),
            "引用的 wiki 页面没落地：{page}"
        );
    }
    // MCP：引用的 id 得在导入后的 servers.json 里找得到
    assert!(
        !target_servers.is_empty(),
        "导入后 MCP server 定义没回来"
    );
    for reference in &restored.mcp_servers {
        let id = reference.rsplit('#').next().unwrap();
        assert!(
            target_servers
                .iter()
                .any(|server| server.get("id").and_then(|v| v.as_str()) == Some(id)),
            "引用的 MCP server 没落地：{reference}"
        );
    }

    let _ = fs::remove_dir_all(source.home());
    let _ = fs::remove_dir_all(target.home());
    let _ = fs::remove_file(&zip_path);
}

/// wiki 页面的元信息（标题 / 标签 / 父页）也要一起过来 —— 不然页面树就散了。
#[test]
fn wiki_page_metadata_survives_the_round_trip() {
    let source = temp_paths("wiki-meta");
    let original = build_source(&source);

    let zip_path = std::env::temp_dir().join("agentspace-roundtrip-wiki.zip");
    let _ = fs::remove_file(&zip_path);
    let selection = ExportSelection {
        agent_ids: vec![original.id.clone()],
        skill_names: vec!["java-rules".to_string(), "vue".to_string()],
        mcp_server_ids: vec!["idea".to_string()],
        extension_names: vec!["my-bridge".to_string()],
        wiki_slugs: vec!["运维手册".to_string()],
    };
    backup::export(&source, &mcp_servers(), &selection, &zip_path).unwrap();

    let target = temp_paths("wiki-meta-target");
    let mut servers: Vec<serde_json::Value> = Vec::new();
    backup::import(&target, &mut servers, &zip_path, &[], &[], None).unwrap();

    let page = wiki::read_page(&target, "运维手册").expect("wiki 页面应该回来了");
    assert_eq!(page.title, "运维手册");
    assert_eq!(page.tags, vec!["运维".to_string()]);
    assert!(page.content.contains("部署步骤"));

    let _ = fs::remove_dir_all(source.home());
    let _ = fs::remove_dir_all(target.home());
    let _ = fs::remove_file(&zip_path);
}

/// 智能体引用了但**没被选进导出清单**的东西 —— 导入后引用会指空。
///
/// 这不是 bug（用户就是只导了一部分），但值得有个测试把行为钉住：
/// 导入后智能体照样带着那个引用，而那个东西不在。
/// 界面上得让人看出「这个引用悬空了」，不能装作没事。
#[test]
fn dangling_reference_is_visible_after_import() {
    let source = temp_paths("dangling");
    let mut original = build_source(&source);
    // 加一个不存在的 skill 引用
    original.skills.push("skills/根本没这个".to_string());
    agent::save(&source, &original).unwrap();

    let zip_path = std::env::temp_dir().join("agentspace-roundtrip-dangling.zip");
    let _ = fs::remove_file(&zip_path);
    let selection = ExportSelection {
        agent_ids: vec![original.id.clone()],
        skill_names: vec!["java-rules".to_string(), "vue".to_string()],
        mcp_server_ids: vec!["idea".to_string()],
        extension_names: vec!["my-bridge".to_string()],
        wiki_slugs: vec!["运维手册".to_string()],
    };
    backup::export(&source, &mcp_servers(), &selection, &zip_path).unwrap();

    let target = temp_paths("dangling-target");
    let mut servers: Vec<serde_json::Value> = Vec::new();
    let result = backup::import(&target, &mut servers, &zip_path, &[], &[], None).unwrap();
    println!("警告：{:?}", result.warnings);

    let restored = &agent::list(&target)[0];
    // 引用原样带过来了（这是对的 —— 智能体的配置原样保留）
    assert!(restored.skills.contains(&"skills/根本没这个".to_string()));
    // 但那个 skill 确实不在 —— 所以必须有警告
    assert!(
        !result.warnings.is_empty(),
        "引用指空了却一点提示都没有 —— 用户会一头雾水"
    );

    let _ = fs::remove_dir_all(source.home());
    let _ = fs::remove_dir_all(target.home());
    let _ = fs::remove_file(&zip_path);
}

/// 智能体绑的是**入口页面**，它的子树自动跟着可见 ——
/// 导出时也得把子树带上，否则子页面就丢了。
#[test]
fn wiki_subtree_travels_with_the_entry_page() {
    let source = temp_paths("wiki-subtree");
    let original = build_source(&source);

    // 造一个子页面（标题跟父页重名 —— slug 会自动避开）
    let child = wiki::create_page(&source, "运维手册", Some("运维手册".to_string())).unwrap();
    let child_slug = child.slug.clone();
    wiki::save_page(
        &source,
        &child_slug,
        "运维手册",
        "# 运维\n\n部署步骤。\n",
        &["运维".to_string()],
        Some("运维手册".to_string()),
    )
    .unwrap();

    let zip_path = std::env::temp_dir().join("agentspace-roundtrip-subtree.zip");
    let _ = fs::remove_file(&zip_path);
    let selection = ExportSelection {
        agent_ids: vec![original.id.clone()],
        skill_names: vec!["java-rules".to_string(), "vue".to_string()],
        mcp_server_ids: vec!["idea".to_string()],
        extension_names: vec!["my-bridge".to_string()],
        // **只选入口页** —— 子页没显式列
        wiki_slugs: vec!["运维手册".to_string()],
    };
    backup::export(&source, &mcp_servers(), &selection, &zip_path).unwrap();

    // 导入到干净环境 —— 入口页和子页都在
    let target = temp_paths("wiki-subtree-target");
    let mut servers: Vec<serde_json::Value> = Vec::new();
    let result = backup::import(&target, &mut servers, &zip_path, &[], &[], None).unwrap();
    assert!(result.failures.is_empty(), "导入不该有失败：{:?}", result.failures);
    assert_eq!(result.imported.wiki, 2, "入口页 + 子页应该都导进来");

    // 父子关系也要保住 —— 页面树不能散
    let entry = wiki::read_page(&target, "运维手册").expect("入口页应该回来了");
    let restored_child = wiki::read_page(&target, &child_slug).expect("子页应该回来了");
    assert_eq!(entry.parent, None);
    assert_eq!(restored_child.parent.as_deref(), Some("运维手册"));

    let _ = fs::remove_dir_all(source.home());
    let _ = fs::remove_dir_all(target.home());
    let _ = fs::remove_file(&zip_path);
}

/// 目录存在但里面是空的情况也别放过。
#[test]
fn skill_directory_exists_but_has_no_skill_md() {
    let source = temp_paths("empty-dir");
    let original = build_source(&source);
    // 造一个只有目录、没有 SKILL.md 的 skill
    fs::create_dir_all(source.skills_root().join("空壳")).unwrap();

    let zip_path = std::env::temp_dir().join("agentspace-roundtrip-empty.zip");
    let _ = fs::remove_file(&zip_path);
    let selection = ExportSelection {
        agent_ids: vec![original.id.clone()],
        skill_names: vec!["java-rules".to_string(), "vue".to_string()],
        mcp_server_ids: vec!["idea".to_string()],
        extension_names: vec!["my-bridge".to_string()],
        wiki_slugs: vec!["运维手册".to_string()],
    };
    backup::export(&source, &mcp_servers(), &selection, &zip_path).unwrap();

    let target = temp_paths("empty-target");
    let mut servers: Vec<serde_json::Value> = Vec::new();
    backup::import(&target, &mut servers, &zip_path, &[], &[], None).unwrap();

    // 空壳 skill 没被选中 —— 不该出现在目标里
    assert!(!Path::new(&target.skills_root().join("空壳")).exists());

    let _ = fs::remove_dir_all(source.home());
    let _ = fs::remove_dir_all(target.home());
    let _ = fs::remove_file(&zip_path);
}

/// 真实往返：拿本机的智能体导一份，导入到干净环境。
///
/// 会**真的 clone 仓库、真的 npm install** —— 所以默认不跑。
/// 手动跑：`cargo test --offline --test agent_roundtrip -- --ignored --nocapture`
///
/// 这是「数据管理导出/导入能不能覆盖这个智能体」的最终验收：
/// 导出的包里，每个绑定的 skill 都得能装回来 —— 哪怕它在仓库里的位置
/// 不常见（分组布局、根目录布局）。
#[test]
#[ignore]
fn real_agent_survives_export_and_import() {
    let source = Paths::from_env();

    // 找本机的智能体当样本
    let agent = agent::list(&source)
        .into_iter()
        .find(|a| a.name == "agent-java8-vue3")
        .expect("本机得有 agent-java8-vue3");
    println!(
        "样本：{}（{}）—— {} 个 skill",
        agent.name,
        agent.id,
        agent.skills.len()
    );

    // 按智能体实际绑的东西导出
    let selection = ExportSelection {
        agent_ids: vec![agent.id.clone()],
        skill_names: agent
            .skills
            .iter()
            .map(|s| s.split('/').next_back().unwrap().to_string())
            .collect(),
        mcp_server_ids: agent
            .mcp_servers
            .iter()
            .map(|s| s.split('#').next_back().unwrap().to_string())
            .collect(),
        extension_names: agent
            .extensions
            .iter()
            .map(|s| s.split('/').next_back().unwrap().to_string())
            .collect(),
        wiki_slugs: agent
            .wiki_pages
            .iter()
            .map(|s| s.split('/').next_back().unwrap().to_string())
            .collect(),
    };

    let zip_path = std::env::temp_dir().join("agentspace-real-agent.zip");
    let _ = fs::remove_file(&zip_path);
    let result = backup::export(&source, &[], &selection, &zip_path).unwrap();
    println!("导出：{:?}", result);

    // 导入到干净环境
    let target = temp_paths("real-target");
    let mut target_servers: Vec<serde_json::Value> = Vec::new();
    let imported = backup::import(&target, &mut target_servers, &zip_path, &[], &[], None).unwrap();
    println!("导入：{:?}", imported.imported);
    println!("失败：{:?}", imported.failures);
    println!("警告：{:?}", imported.warnings);

    // 每个绑定的 skill 都要装回来
    let mut missing = Vec::new();
    for skill in &agent.skills {
        let name = skill.split('/').next_back().unwrap();
        if !target.skills_root().join(name).join("SKILL.md").is_file() {
            missing.push(skill.clone());
        }
    }
    assert!(
        missing.is_empty(),
        "这些 skill 导入后没装回来：{missing:?}"
    );

    // 智能体也要回来，引用还得原样
    let restored: Vec<_> = agent::list(&target)
        .into_iter()
        .filter(|a| a.id == agent.id)
        .collect();
    assert_eq!(restored.len(), 1, "智能体没回来");
    assert_eq!(restored[0].skills, agent.skills);
    assert_eq!(restored[0].mcp_servers, agent.mcp_servers);
    assert_eq!(restored[0].extensions, agent.extensions);
    assert_eq!(restored[0].wiki_pages, agent.wiki_pages);
    assert_eq!(restored[0].instruction, agent.instruction);

    let _ = fs::remove_dir_all(target.home());
    let _ = fs::remove_file(&zip_path);
}
