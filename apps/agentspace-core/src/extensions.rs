//! Pi 扩展的管理。
//!
//! # Pi 的扩展从哪来
//!
//! 四个来源（见 pi 的 `docs/extensions.md`）：
//!
//! | 来源 | 位置 | 作用域 |
//! |---|---|---|
//! | 自动发现 | `~/.pi/agent/extensions/*.ts` | 全局 |
//! | 自动发现 | `<项目>/.pi/extensions/*.ts` | 项目 |
//! | 配置声明 | `settings.json` 的 `extensions: []` | 全局 / 项目 |
//! | package | 包里的 `extensions/` 目录 | 跟着包 |
//!
//! 扩展是 TypeScript 文件，导出默认工厂函数 `function (pi: ExtensionAPI)`。
//! Pi 用 jiti 加载 —— 不需要编译。
//!
//! # 为什么自己扫，不问 pi
//!
//! pi 的 `listConfiguredPackages()` 只给「配置了哪些包」，
//! 不给「包里有哪些扩展」。要看到扩展本身就得自己扫目录。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::paths::Paths;

/// 扩展的来源种类。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExtensionSourceKind {
    /// pi 自带的（全局目录里直接放的扩展文件）
    Builtin,
    /// 我们从 npm 装到工具箱里的
    Npm,
    /// 用户自己写放到工具箱里的
    Custom,
}

impl ExtensionSourceKind {
    /// 显示名。
    pub fn label(self) -> &'static str {
        match self {
            ExtensionSourceKind::Builtin => "Pi 自带",
            ExtensionSourceKind::Npm => "npm",
            ExtensionSourceKind::Custom => "自定义",
        }
    }

    /// 能不能绑定到智能体。
    ///
    /// pi 自带的扩展运行时自己会加载 —— 不用（也不能）由我们绑。
    pub fn bindable(self) -> bool {
        matches!(self, ExtensionSourceKind::Npm | ExtensionSourceKind::Custom)
    }
}

/// 一个已安装的扩展。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    /// 扩展名（文件名去掉扩展名）。
    pub name: String,
    /// 扩展文件或目录的绝对路径。
    pub path: PathBuf,
    /// 来源种类。
    pub source: ExtensionSourceKind,
    /// 来自哪个包（来源是 package 时有值）。
    pub package: Option<String>,
    /// 是否启用（Pi 没有「禁用」机制 —— 停用靠移走文件）。
    pub enabled: bool,
    /// 文件大小（字节）。
    pub size: u64,
    /// 最后修改时间（epoch 毫秒）。
    pub updated_at_ms: u64,
}

/// Pi 的 agent 目录（`~/.pi/agent`）。
pub fn agent_dir(paths: &Paths) -> PathBuf {
    paths.home().join(".pi").join("agent")
}

/// 项目里 pi 的配置目录（`<项目>/.pi`）。
pub fn project_pi_dir(project: &Path) -> PathBuf {
    project.join(".pi")
}

/// 扫一个目录里的扩展。
///
/// 扩展是 `*.ts` / `*.js` 文件，或含 `index.ts` 的子目录。
fn scan_extensions(dir: &Path, kind: ExtensionSourceKind, package: Option<String>) -> Vec<ExtensionInfo> {
    let mut out: Vec<ExtensionInfo> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().map(|n| n.to_string_lossy().to_string());
        let Some(name) = name else { continue };

        // 停用的扩展被移到一边 —— 不算已装
        if name.starts_with('.') || name.ends_with(".disabled") {
            continue;
        }

        let is_file = path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("ts") || ext.eq_ignore_ascii_case("js"))
            .unwrap_or(false);
        let is_dir = path.is_dir() && path.join("index.ts").is_file();
        if !is_file && !is_dir {
            continue;
        }

        let stem = if is_dir {
            name.clone()
        } else {
            path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or(name.clone())
        };
        out.push(ExtensionInfo {
            name: stem,
            size: dir_size(&path),
            updated_at_ms: file_modified_ms(&path),
            enabled: true,
            path,
            source: kind,
            package: package.clone(),
        });
    }
    out
}

/// 目录的总大小（字节）。
fn dir_size(path: &Path) -> u64 {
    if path.is_file() {
        return std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        total += dir_size(&entry.path());
    }
    total
}

/// 最后修改时间（epoch 毫秒）。
fn file_modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 扩展库的位置（工具箱指定位置）。
///
/// npm 下载的和自定义的扩展都放这儿 —— 不进 pi 的全局目录
/// （`~/.pi/agent/extensions/`），那是 pi 自带扩展的地方。
///
/// ```text
/// ~/.agent-compose/extensions/
///   npm/<name>/        npm 包（整包复制，含 package.json）
///   custom/<name>/     用户自己写的
/// ```
pub fn library_dir(paths: &Paths) -> PathBuf {
    paths.root().join("extensions")
}

/// 列出已安装的扩展。
///
/// 三个来源：
/// - **Pi 自带**：`~/.pi/agent/extensions/` 里的 —— 只读，运行时自动生效
/// - **npm**：我们装到工具箱里的
/// - **自定义**：用户自己写放到工具箱里的
///
/// 只有后两种能绑到智能体上。
pub fn list_installed(paths: &Paths, project: Option<&Path>) -> Vec<ExtensionInfo> {
    let mut out: Vec<ExtensionInfo> = Vec::new();

    // 1) pi 自带的 —— 全局目录 + 项目目录
    out.extend(scan_extensions(
        &agent_dir(paths).join("extensions"),
        ExtensionSourceKind::Builtin,
        None,
    ));
    if let Some(project) = project {
        out.extend(scan_extensions(
            &project_pi_dir(project).join("extensions"),
            ExtensionSourceKind::Builtin,
            None,
        ));
    }

    // 2) 工具箱里的 npm 包
    //
    // 每个扩展一个自己的目录：`<lib>/npm/<flat>/`，
    // 依赖在它自己的 `node_modules/` 里。
    let npm_root = library_dir(paths).join("npm");
    if let Ok(entries) = std::fs::read_dir(&npm_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = read_package_name(&path).unwrap_or_else(|| {
                path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()
            });
            out.extend(scan_package(&path, ExtensionSourceKind::Npm, Some(name)));
        }
    }

    // 3) 工具箱里的自定义扩展
    let custom_root = library_dir(paths).join("custom");
    if let Ok(entries) = std::fs::read_dir(&custom_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            out.extend(scan_package(&path, ExtensionSourceKind::Custom, Some(name)));
        }
    }

    out.sort_by(|a, b| {
        a.source
            .label()
            .cmp(b.source.label())
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

/// 扫一个扩展目录。
///
/// 目录里可能是：
/// - `index.ts` / `index.js` —— 直接就是扩展
/// - `package.json` 的 `pi.extensions` 声明 —— 包带来的
fn scan_package(
    dir: &Path,
    kind: ExtensionSourceKind,
    name: Option<String>,
) -> Vec<ExtensionInfo> {
    let mut out: Vec<ExtensionInfo> = Vec::new();

    // package.json 的 pi.extensions 声明
    let declared = read_declared_extensions(dir);
    for path in declared {
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        out.push(ExtensionInfo {
            name: name.clone().unwrap_or(stem),
            size: dir_size(&path),
            updated_at_ms: file_modified_ms(&path),
            enabled: true,
            path,
            source: kind,
            package: None,
        });
    }

    // index.ts / index.js
    for file_name in ["index.ts", "index.js"] {
        let path = dir.join(file_name);
        if !path.is_file() {
            continue;
        }
        // 已经被 package.json 声明过了就不重复
        if out.iter().any(|item| item.path == path) {
            continue;
        }
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        out.push(ExtensionInfo {
            name: name.clone().unwrap_or(stem),
            size: dir_size(&path),
            updated_at_ms: file_modified_ms(&path),
            enabled: true,
            path,
            source: kind,
            package: None,
        });
    }
    out
}

/// 读 package.json 里 `pi.extensions` 声明的扩展文件。
fn read_declared_extensions(dir: &Path) -> Vec<PathBuf> {
    let Ok(raw) = std::fs::read_to_string(dir.join("package.json")) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(items) = value
        .get("pi")
        .and_then(|pi| pi.get("extensions"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| item.as_str())
        .map(|rel| dir.join(rel.trim_start_matches("./")))
        .filter(|path| path.is_file())
        .collect()
}

/// 从 npm 装一个扩展到工具箱。
///
/// 不走 `pi install` —— 那会把声明写进 pi 的全局 settings.json，
/// 扩展也落在 pi 的全局目录。我们要自己管：装到 `~/.agent-compose/extensions/npm/`。
///
/// 步骤：`npm pack` 拿 tarball → 解压（tarball 里是 `package/` 前缀）。
pub fn install_from_npm(
    paths: &Paths,
    name: &str,
) -> Result<ExtensionInfo, String> {
    let trimmed = name.trim();
    validate_package_name(trimmed)?;

    let npm = match find_npm() {
        Some(path) => path,
        None => return Err("找不到 npm —— 装扩展需要 node 环境".to_string()),
    };

    // 先装到临时目录 —— npm 会把依赖一起装上（pack 不行，pack 只下 tarball）。
    //
    // 为什么用临时目录而不是直接装到工具箱：
    // `npm install X` 会重算整棵依赖树，把 node_modules 里**不相关的包删掉**。
    // 扩展库是多个扩展并存的 —— 装一个不能把别的冲掉。
    // 临时目录名要带随机后缀 —— 同进程里可能同时装多个（pid 是一样的）
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let staging = std::env::temp_dir().join(format!("agentspace-npm-{}-{nonce}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("创建临时目录失败：{e}"))?;

    let output = std::process::Command::new(&npm)
        .args([
            "install",
            trimmed,
            "--prefix",
            &staging.to_string_lossy(),
            "--no-save",
            "--silent",
            "--no-audit",
            "--no-fund",
        ])
        .output()
        .map_err(|e| format!("执行 npm 失败：{e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!(
            "npm install {trimmed} 失败：{}",
            if stderr.is_empty() { "未知原因" } else { &stderr }
        ));
    }

    let staged_modules = staging.join("node_modules");
    let Some(package_dir) = resolve_in_node_modules(&staged_modules, trimmed) else {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("npm 装完了但找不到 {trimmed}"));
    };

    // 目标：每个扩展一个自己的目录，依赖跟着自己走。
    //
    //   <lib>/npm/<flat>/
    //     <包本体>
    //     node_modules/<依赖>/…
    //
    // 扩展里 `import yaml from 'yaml'` 靠的是 node 的模块解析（从扩展文件往上
    // 找 node_modules）—— 依赖不带在身边就会报 "Cannot find module 'yaml'"。
    let flat = flat_dir_name(trimmed);
    let target = library_dir(paths).join("npm").join(&flat);
    let _ = std::fs::remove_dir_all(&target);
    std::fs::create_dir_all(&target).map_err(|e| format!("创建目录失败：{e}"))?;

    if let Err(error) = copy_dir(&package_dir, &target) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("复制扩展失败：{error}"));
    }

    // 依赖：只带这个包真正要的（直接 + 传递）
    let deps = collect_dependencies(&staged_modules, &package_dir);
    for (dep_name, dep_dir) in deps {
        let dest = target.join("node_modules").join(&dep_name);
        if let Some(parent) = dest.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(error) = copy_dir(&dep_dir, &dest) {
            eprintln!("复制依赖失败（{dep_name}）：{error}");
        }
    }
    let _ = std::fs::remove_dir_all(&staging);

    let found = scan_package(&target, ExtensionSourceKind::Npm, Some(trimmed.to_string()));
    found
        .into_iter()
        .next()
        .ok_or_else(|| format!("{trimmed} 里没找到扩展（包要先在 pi 的市场里发布）"))
}

/// 包名 → 目录名（scoped 的斜杠换成连字符，pi 只扫下一层）。
pub fn flat_dir_name(package: &str) -> String {
    package.replace('/', "-")
}

/// 递归复制目录。
pub fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("创建目录失败：{e}"))?;
    let entries = std::fs::read_dir(from).map_err(|e| format!("读目录失败：{e}"))?;
    for entry in entries.flatten() {
        let source = entry.path();
        let target = to.join(entry.file_name());
        if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            copy_dir(&source, &target)?;
        } else {
            std::fs::copy(&source, &target).map_err(|e| format!("复制文件失败：{e}"))?;
        }
    }
    Ok(())
}

/// 读一个自定义扩展的源码。
pub fn read_custom(paths: &Paths, name: &str) -> Result<String, String> {
    let target = library_dir(paths).join("custom").join(name.trim()).join("index.ts");
    std::fs::read_to_string(&target).map_err(|e| format!("读取失败：{e}"))
}

/// 写一个自定义扩展的源码。
///
/// 自定义扩展就一个 `index.ts` —— pi 直接加载它。返回写到哪了。
pub fn write_custom(paths: &Paths, name: &str, code: &str) -> Result<PathBuf, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("扩展名不能为空".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("扩展名不合法".to_string());
    }
    let dir = library_dir(paths).join("custom").join(trimmed);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败：{e}"))?;
    let target = dir.join("index.ts");
    std::fs::write(&target, code).map_err(|e| format!("写入失败：{e}"))?;
    Ok(target)
}

/// 删掉工具箱里的一个扩展（npm 或自定义）。
///
/// npm 的目录连同它自带的 node_modules 一起删 —— 依赖不会留成孤儿。
pub fn remove_from_library(
    paths: &Paths,
    source: ExtensionSourceKind,
    name: &str,
) -> Result<(), String> {
    match source {
        ExtensionSourceKind::Npm => {
            // 每个扩展一个自己的目录 —— 直接删掉就行
            // （依赖在它自己的 node_modules 里，一并清掉）
            //
            // 名字可以给扁平目录名（`@scope-pkg`）也可以给包名（`@scope/pkg`）——
            // 用户两个都习惯用。
            let npm_root = library_dir(paths).join("npm");
            let flat = flat_dir_name(name.trim());
            let dir = if npm_root.join(&flat).is_dir() {
                npm_root.join(&flat)
            } else {
                find_npm_package_dir(&npm_root, name.trim()).unwrap_or(npm_root.join(&flat))
            };
            if !dir.exists() {
                return Err(format!("没找到扩展：{name}"));
            }
            std::fs::remove_dir_all(&dir).map_err(|e| format!("删除失败：{e}"))
        }
        ExtensionSourceKind::Custom => {
            let dir = library_dir(paths).join("custom").join(name.trim());
            if !dir.exists() {
                return Ok(());
            }
            std::fs::remove_dir_all(&dir).map_err(|e| format!("删除失败：{e}"))
        }
        // pi 自带的不能删 —— 那是 pi 的东西
        ExtensionSourceKind::Builtin => {
            Err("Pi 自带的扩展不能在这里删除".to_string())
        }
    }
}

/// 在工具箱的 npm 目录里按包名找一个扩展目录。
///
/// 目录名是扁平化的（`@dietrichgebert-ponytail`），但引用里存的可能是包名
/// （`@dietrichgebert/ponytail`）—— 所以得读 package.json 对上。
pub fn find_npm_package_dir(npm_root: &Path, package: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(npm_root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if read_package_name(&path).as_deref() == Some(package) {
            return Some(path);
        }
    }
    None
}

/// 读 package.json 里的包名。
///
/// 目录名是扁平化的（`@dietrichgebert-ponytail`），显示时用回原名
/// （`@dietrichgebert/ponytail`）—— 包自己最清楚自己叫什么。
pub fn read_package_name(dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let name = value.get("name")?.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

/// 一个扩展目录对应的包名（读它的 package.json）。
pub fn package_name_of(dir: &Path) -> Option<String> {
    read_package_name(dir)
}

/// 读 package.json 里的 dependencies。
fn read_dependencies(dir: &Path) -> Vec<String> {
    let Ok(raw) = std::fs::read_to_string(dir.join("package.json")) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(deps) = value.get("dependencies").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    deps.keys().map(|key| key.clone()).collect()
}

/// 在 node_modules 里找一个包（scoped 的多一层）。
pub fn resolve_in_node_modules(node_modules: &Path, name: &str) -> Option<PathBuf> {
    let mut dir = node_modules.to_path_buf();
    for part in name.split('/') {
        if part.is_empty() {
            return None;
        }
        dir = dir.join(part);
    }
    if dir.is_dir() { Some(dir) } else { None }
}

/// 算一个包的依赖闭包（直接 + 传递）。
///
/// npm 3+ 把依赖扁平化到 node_modules 顶层，所以闭包里的包都在那一层。
/// 扩展被复制到别的目录后，这些依赖得跟着走 —— 否则
/// `import yaml from 'yaml'` 会报 "Cannot find module 'yaml'"。
pub fn collect_dependencies(node_modules: &Path, pkg_dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out: Vec<(String, PathBuf)> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut queue: Vec<PathBuf> = vec![pkg_dir.to_path_buf()];

    while let Some(dir) = queue.pop() {
        for dep in read_dependencies(&dir) {
            let Some(dep_dir) = resolve_in_node_modules(node_modules, &dep) else {
                continue;
            };
            if seen.iter().any(|item| item == &dep) {
                continue;
            }
            seen.push(dep.clone());
            out.push((dep.clone(), dep_dir.clone()));
            queue.push(dep_dir);
        }
    }
    out
}

/// 校验 npm 包名。
///
/// 认两种：
/// - 普通包：`pi-web-access`
/// - scoped 包：`@dietrichgebert/ponytail`（斜杠只能有一个，且必须在 @ 后面）
fn validate_package_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("包名不能为空".to_string());
    }
    // scoped 包的 @ 后面是 `scope/name`，否则就是纯名字
    let (scope, body) = match name.strip_prefix('@') {
        Some(rest) => match rest.split_once('/') {
            Some((scope, body)) => (Some(scope), body),
            None => (None, rest),
        },
        None => (None, name),
    };

    if let Some(scope) = scope {
        if scope.is_empty() || scope.contains('/') {
            return Err(format!("包名不合法：{name}"));
        }
    }
    if body.is_empty() || body.contains('/') {
        return Err(format!("包名不合法：{name}"));
    }
    if body == "." || body == ".." || scope == Some(".") || scope == Some("..") {
        return Err(format!("包名不合法：{name}"));
    }
    // windows 文件名不能用的字符
    if body.chars().any(|ch| "<>:\"|?*".contains(ch)) {
        return Err(format!("包名不合法：{name}"));
    }
    Ok(())
}



/// 找 npm。
fn find_npm() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) {
        &["npm.cmd", "npm.exe", "npm.bat", "npm"]
    } else {
        &["npm"]
    };
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}


/// 启用 / 停用一个扩展。
///
/// Pi 没有「禁用某个扩展」的机制 —— 它按目录里的文件加载。
/// 所以停用 = 把文件改名加 `.disabled` 后缀，启用 = 改回来。
pub fn set_enabled(path: &Path, enabled: bool) -> Result<(), String> {
    if enabled {
        // 停用时文件名变成了 `xxx.ts.disabled` —— 启用就是去掉这个后缀。
        // 两种传法都要认：
        // - 传停用后的路径（`xxx.ts.disabled`）→ 直接去掉后缀
        // - 传原始路径（`xxx.ts`）→ 找带后缀的那个
        if path.extension().map(|e| e == "disabled").unwrap_or(false) {
            let target = path.with_extension("");
            std::fs::rename(path, &target).map_err(|e| format!("启用失败：{e}"))?;
            return Ok(());
        }
        let candidate = PathBuf::from(format!("{}.disabled", path.display()));
        if candidate.exists() {
            std::fs::rename(&candidate, path).map_err(|e| format!("启用失败：{e}"))?;
        }
        return Ok(());
    }
    // 停用：改名加后缀
    let target = path.with_extension(format!(
        "{}.disabled",
        path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default()
    ));
    std::fs::rename(path, target).map_err(|e| format!("停用失败：{e}"))
}

/// 删掉一个扩展（文件或整个目录）。
pub fn remove(path: &Path) -> Result<(), String> {
    let result = if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    result.map_err(|e| format!("删除失败：{e}"))
}

/// 读一个扩展的源码。
pub fn read_source(path: &Path) -> Result<String, String> {
    if path.is_dir() {
        let file = path.join("index.ts");
        return std::fs::read_to_string(&file).map_err(|e| format!("读取失败：{e}"));
    }
    std::fs::read_to_string(path).map_err(|e| format!("读取失败：{e}"))
}

/// 新扩展的模板。
pub const TEMPLATE: &str = r#"import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("扩展已加载", "info")
  })
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_is_valid_ts_shape() {
        assert!(TEMPLATE.contains("export default function"));
        assert!(TEMPLATE.contains("ExtensionAPI"));
    }




    #[test]
    fn scans_ts_files_and_dirs() {
        let dir = std::env::temp_dir().join(format!("agentspace-core-ext-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.ts"), "export default function () {}").unwrap();
        std::fs::write(dir.join("notes.md"), "x").unwrap();
        std::fs::create_dir_all(dir.join("pkg")).unwrap();
        std::fs::write(dir.join("pkg/index.ts"), "export default function () {}").unwrap();

        let found = scan_extensions(&dir, ExtensionSourceKind::Builtin, None);
        let names: Vec<String> = found.iter().map(|item| item.name.clone()).collect();
        assert!(names.contains(&"a".to_string()), "{names:?}");
        assert!(names.contains(&"pkg".to_string()), "{names:?}");
        assert!(!names.contains(&"notes".to_string()), "{names:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn disabled_extension_is_not_listed() {
        let dir = std::env::temp_dir().join(format!("agentspace-core-ext2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.ts.disabled"), "x").unwrap();
        let found = scan_extensions(&dir, ExtensionSourceKind::Builtin, None);
        assert!(found.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// 实测：从 npm 装一个扩展到工具箱
    #[test]
    #[ignore = "需要网络"]
    fn live_install_from_npm() {
        let paths = Paths::from_env();
        let info = install_from_npm(&paths, "pi-subagents").unwrap();
        println!("装好了：{} -> {:?}", info.name, info.path);
        assert!(info.path.exists());
        // 装到工具箱，不在 pi 的全局目录
        assert!(info.path.to_string_lossy().contains("agent-compose"));

        // 每个扩展一个自己的目录，依赖跟着自己走
        let dir = library_dir(&paths).join("npm").join("pi-subagents");
        assert!(dir.join("package.json").is_file());
        assert!(dir.join("node_modules").is_dir(), "依赖没跟着装");
    }

    /// 装第二个扩展不能把第一个冲掉。
    ///
    /// `npm install X` 会重算整棵依赖树，把 node_modules 里不相关的包删掉 ——
    /// 所以每个扩展得装到自己的目录。
    #[test]
    #[ignore = "需要网络"]
    fn live_install_keeps_other_extensions() {
        let paths = Paths::from_env();
        install_from_npm(&paths, "pi-subagents").unwrap();
        install_from_npm(&paths, "@dietrichgebert/ponytail").unwrap();
        install_from_npm(&paths, "billion-context").unwrap();
        install_from_npm(&paths, "context-mode").unwrap();

        let npm_root = library_dir(&paths).join("npm");
        assert!(npm_root.join("pi-subagents").join("package.json").is_file());
        assert!(npm_root
            .join("@dietrichgebert-ponytail")
            .join("package.json")
            .is_file());
        assert!(npm_root.join("billion-context").join("package.json").is_file());
        assert!(npm_root.join("context-mode").join("package.json").is_file());
    }
}

#[cfg(test)]
mod scoped_tests {
    use super::*;

    #[test]
    fn accepts_scoped_package_names() {
        assert!(validate_package_name("@dietrichgebert/ponytail").is_ok());
        assert!(validate_package_name("pi-web-access").is_ok());
        assert!(validate_package_name("@scope/pkg").is_ok());
    }

    #[test]
    fn rejects_broken_package_names() {
        assert!(validate_package_name("").is_err());
        assert!(validate_package_name("a/b/c").is_err());
        assert!(validate_package_name("@/pkg").is_err());
        assert!(validate_package_name("@scope/").is_err());
        assert!(validate_package_name("../escape").is_err());
        assert!(validate_package_name("bad:name").is_err());
    }

    #[test]
    fn scoped_name_resolves_in_node_modules() {
        let root = Path::new("/lib/node_modules");
        assert_eq!(
            resolve_in_node_modules(root, "@dietrichgebert/ponytail"),
            None
        );
    }

    /// 停用再启用要能改回原文件名。
    ///
    /// 停用把 `xxx.ts` 改名成 `xxx.ts.disabled` —— 启用时得找得回来。
    #[test]
    fn enable_restores_disabled_file() {
        let dir = std::env::temp_dir().join("agentspace-core-toggle");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("my-ext.ts");
        std::fs::write(&file, "export default () => {}").unwrap();

        set_enabled(&file, false).unwrap();
        assert!(!file.exists());
        let disabled = dir.join("my-ext.ts.disabled");
        assert!(disabled.exists(), "停用后应该是 my-ext.ts.disabled");

        // 传原始路径
        set_enabled(&file, true).unwrap();
        assert!(file.exists(), "启用后应该改回 my-ext.ts");

        // 传停用后的路径
        set_enabled(&file, false).unwrap();
        set_enabled(&disabled, true).unwrap();
        assert!(file.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod live_tests2 {
    use super::*;

    /// 实测：装完的 scoped 包能被列出来、也能被删掉
    #[test]
    #[ignore = "需要网络"]
    fn live_scoped_roundtrip() {
        let paths = Paths::from_env();
        let pkg = "@dietrichgebert/ponytail";
        let info = install_from_npm(&paths, pkg).unwrap();
        println!("装好了：{} -> {:?}", info.name, info.path);
        assert_eq!(info.name, pkg);

        // 列出来时能认出它
        let listed = list_installed(&paths, None);
        let found = listed.iter().find(|item| item.source == ExtensionSourceKind::Npm);
        println!("列出来：{:?}", found.map(|i| i.name.clone()));
        assert!(found.is_some());

        // 删得掉（目录名是扁平化的）
        remove_from_library(&paths, ExtensionSourceKind::Npm, pkg).unwrap();
        let after = list_installed(&paths, None);
        assert!(!after
            .iter()
            .any(|item| item.source == ExtensionSourceKind::Npm && item.name == pkg));
        println!("删掉了");
    }
}
