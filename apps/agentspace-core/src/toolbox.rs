//! 本机 CLI agent（Claude Code / Codex / Gemini CLI …）探测。
//!
//! 思路抄自 cc-switch（https://github.com/farion1231/cc-switch，MIT）：
//! - **先 PATH 后兜底目录**：PATH 里解析到的那个就是用户真正在终端里跑的那个，
//!   免得硬编码目录里的旧 shim 盖住新版本；PATH 确实没有才去常见安装目录扫。
//! - **三态结果**：`Found`（拿到版本）/ `FoundButBroken`（文件在但 `--version`
//!   跑不起来，如 Node 版本不达标）/ `NotFound`（真没装）。前端据此区分
//!   「未安装」和「已安装·无法运行」，不用去匹配错误文案反推语义。
//! - **只跑已定位到的真实可执行文件**：不执行 `cmd /C <tool>`，避免误触发
//!   App Execution Alias / 协议处理器。

use crate::paths::Paths;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// 支持探测的 CLI agent：`(命令名, 展示名)`。
///
/// **完全对齐 cc-switch**（MIT）支持的工具列表 —— 不多不少：
/// cc-switch 没有的这里也不该有，cc-switch 有的这里也得跟上。
const AGENT_SPECS: &[(&str, &str)] = &[
    ("claude", "Claude Code"),
    ("codex", "Codex"),
    ("gemini", "Gemini CLI"),
    ("grok", "Grok Build"),
    ("opencode", "OpenCode"),
    ("openclaw", "OpenClaw"),
    ("hermes", "Hermes"),
    ("pi", "Pi"),
    ("omp", "Oh My Pi"),
    ("mcode", "MiniMax Code"),
    ("kimi", "Kimi Code"),
    ("dsh", "DeepSeek Harness"),
    ("agy", "Antigravity CLI"),
    ("copilot", "GitHub Copilot CLI"),
];

/// 单个 `--version` 的超时。
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// npm 包名（能通过 npm/pnpm/bun 升级的工具）。
fn npm_package_for(command: &str) -> Option<&'static str> {
    match command {
        "claude" => Some("@anthropic-ai/claude-code"),
        "codex" => Some("@openai/codex"),
        "gemini" => Some("@google/gemini-cli"),
        "grok" => Some("@xai-official/grok"),
        "opencode" => Some("opencode-ai"),
        "openclaw" => Some("openclaw"),
        "pi" => Some("@earendil-works/pi-coding-agent"),
        "omp" => Some("@oh-my-pi/pi-coding-agent"),
        "mcode" => Some("@minimax-ai/code"),
        "kimi" => Some("@moonshot-ai/kimi-code"),
        "dsh" => Some("@deepseek-ai/dsh"),
        "copilot" => Some("@github/copilot"),
        _ => None,
    }
}

/// 有些包只能由特定包管理器装/升（抄 cc-switch 的约束）。
///
/// omp 的 npm 包只能由 bun 跑 —— 用 npm 装出来的 omp 是跑不起来的。
fn required_manager(command: &str) -> Option<&'static str> {
    match command {
        "omp" => Some("bun"),
        _ => None,
    }
}

/// 从路径推断安装来源（决定升级用哪个包管理器）。
fn infer_source(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/").to_lowercase();
    if text.contains("/.nvm/") || text.contains("/nvm/") {
        // nvm-windows 的全局包装在 node 版本目录里（`.../nvm/v20.11.1/claude.cmd`）。
        "nvm".to_string()
    } else if text.contains("/homebrew/") || text.contains("/cellar/") || text.contains("/caskroom/") {
        "homebrew".to_string()
    } else if text.contains("/.volta/") || text.contains("/volta/") {
        "volta".to_string()
    } else if text.contains("/fnm_multishells") || text.contains("/fnm/") {
        "fnm".to_string()
    } else if text.contains("/.mise/") || text.contains("/mise/") {
        "mise".to_string()
    } else if text.contains("/.bun/") {
        "bun".to_string()
    } else if text.contains("/pnpm/") {
        "pnpm".to_string()
    } else if text.contains("/scoop/") {
        "scoop".to_string()
    } else if text.contains("/.local/pipx/") {
        "pipx".to_string()
    } else if text.contains("/npm/") || text.contains("/nodejs/") {
        // npm 全局 bin 目录：默认 `%APPDATA%\npm`，或 node 安装目录本身
        // （`C:\Program Files\nodejs\claude.cmd` / `D:\nodejs\claude.cmd`）。
        "npm".to_string()
    } else if has_node_modules_sibling(path) {
        // 自定义 prefix 的 npm 全局 bin 目录：同目录下有 node_modules。
        "npm".to_string()
    } else {
        "unknown".to_string()
    }
}

/// 同目录下有没有 node_modules —— 有的话这就是 npm 的全局 bin 目录。
fn has_node_modules_sibling(path: &Path) -> bool {
    path.parent()
        .map(|dir| dir.join("node_modules").is_dir())
        .unwrap_or(false)
}

/// 同目录下的另一个可执行（npm / pnpm / bun / volta）。
///
/// Windows 上这些入口的扩展名可能是 `.cmd` 也可能是 `.exe`，
/// 纯拼字符串猜不出来，得挨个试（抄 cc-switch 的 `sibling_bin_with_ext`）。
///
/// 为什么要「同目录」：包管理器都把自己的 cli 跟它装的命令放同一个 bin 目录，
/// 从那儿推导出来的绝对路径才是同一套 node 安装 —— GUI 进程的 PATH 常常
/// 看不到 nvm/fnm 下的 node，光靠 PATH 里的 `npm` 会打到别的 node 上。
fn sibling_binary(bin_path: &Path, name: &str, exts: &[&str]) -> Option<PathBuf> {
    let dir = bin_path.parent()?;
    for ext in exts {
        let candidate = dir.join(format!("{name}.{ext}"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// 一处安装。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstall {
    /// 可执行文件路径。
    pub path: String,
    /// `--version` 解析出的版本。
    pub version: Option<String>,
    /// `--version` 是否成功跑完（装了但跑不起来时为 false）。
    pub runnable: bool,
    /// 跑不起来时的诊断。
    pub error: Option<String>,
    /// 推断的安装来源：npm / pnpm / bun / nvm / volta / homebrew / scoop / pipx。
    pub source: String,
    /// 是否是 PATH 解析到的那处（= 升级会作用的目标）。
    pub is_path_default: bool,
}

/// 探测到的一个 CLI agent。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    /// 稳定标识（命令名）。
    pub id: String,
    /// 展示名。
    pub name: String,
    /// 命令名（终端里敲的那个）。
    pub command: String,
    /// 是否检测到。
    pub installed: bool,
    /// 版本号；装了但跑不起来时为空。
    pub version: Option<String>,
    /// 可执行文件绝对路径（PATH 默认的那处）。
    pub path: Option<String>,
    /// 装了但跑不起来的原因。
    pub error: Option<String>,
    /// 全部安装位置（第一处是 PATH 默认的那处）。
    pub installs: Vec<AgentInstall>,
    /// npm 包名（可升级的走 npm/pnpm/bun 时有值）。
    pub package: Option<String>,
    /// 安装来源（推断）。
    pub source: String,
    /// registry 上的最新版本（联网查得到才有）。
    pub latest_version: Option<String>,
}

// ---------------------------------------------------------------- 路径

/// PATH 里的全部目录。
fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default()
}

/// 读一个环境变量里的目录（空值当没设）。
fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// %LOCALAPPDATA%（Windows）。
fn local_appdata() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir_fallback().join("AppData").join("Local"))
}

/// 主目录（拿不到时的兜底）。
fn home_dir_fallback() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// 往搜索路径里加一个目录（去重）。
fn push_dir(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
        dirs.push(dir);
    }
}

/// 把 `base` 下的每个子目录加进搜索路径（可选再拼一层后缀）。
///
/// nvm-windows / mise / fnm 这类「一个根目录下面每个版本一个子目录」的布局
/// 就靠它展开 —— 否则只能看见根目录，看不见里面各个版本目录里的安装。
fn push_child_dirs(dirs: &mut Vec<PathBuf>, base: &Path, suffix: Option<&str>) {
    if !base.exists() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = match suffix {
            Some(suffix) => entry.path().join(suffix),
            None => entry.path(),
        };
        if path.exists() && !dirs.contains(&path) {
            dirs.push(path);
        }
    }
}

/// 某个工具自己的安装目录（官方安装器 / 安装脚本放的位置）。
///
/// 抄 cc-switch 的 `build_tool_search_paths`：这些位置常常不在 PATH 里
/// （GUI 进程继承到的 PATH 也不一定完整），漏了就会把「装了」报成「没装」。
fn tool_extra_dirs(paths: &Paths, command: &str) -> Vec<PathBuf> {
    let home = paths.home().to_path_buf();
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut push = |dir: PathBuf| {
        if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    };

    match command {
        // Kimi CLI 官方安装器：~/.kimi-code/bin（可用 KIMI_INSTALL_DIR 改）
        "kimi" => {
            if let Some(dir) = env_dir("KIMI_INSTALL_DIR") {
                push_dir(&mut dirs, dir.join("bin"));
            }
            push_dir(&mut dirs, home.join(".kimi-code").join("bin"));
        }
        // Grok CLI：~/.grok/bin（可用 GROK_BIN_DIR 改）
        "grok" => {
            if let Some(dir) = env_dir("GROK_BIN_DIR") {
                push_dir(&mut dirs, dir);
            }
            push_dir(&mut dirs, home.join(".grok").join("bin"));
        }
        // MiniMax Code 官方安装器：Windows 装在安装根目录，unix 在 bin 下
        "mcode" => {
            let launcher = |root: PathBuf| {
                if cfg!(target_os = "windows") {
                    root
                } else {
                    root.join("bin")
                }
            };
            if let Some(dir) = env_dir("MCODE_INSTALL_DIR") {
                push_dir(&mut dirs, launcher(dir));
            }
            push_dir(&mut dirs, launcher(home.join(".minimax-code")));
        }
        // OpenCode 的 install.sh 位置
        "opencode" => {
            if let Some(dir) = env_dir("OPENCODE_INSTALL_DIR") {
                push_dir(&mut dirs, dir);
            }
            if let Some(dir) = env_dir("XDG_BIN_DIR") {
                push_dir(&mut dirs, dir);
            }
            push_dir(&mut dirs, home.join("bin"));
            push_dir(&mut dirs, home.join(".opencode").join("bin"));
            push_dir(&mut dirs, home.join("go").join("bin"));
        }
        // 原生安装器（非 npm 包）
        "codex" => push(
            local_appdata()
                .join("Programs")
                .join("OpenAI")
                .join("Codex")
                .join("bin"),
        ),
        "claude" => push(local_appdata().join("Programs").join("claude")),
        "agy" => push(local_appdata().join("agy").join("bin")),
        _ => {}
    }

    dirs
}

/// 常见安装目录（PATH 里没有时兜底扫）。
fn fallback_dirs(paths: &Paths) -> Vec<PathBuf> {
    let home = paths.home().to_path_buf();
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Some(appdata) = std::env::var_os("APPDATA") {
        let appdata = PathBuf::from(appdata);
        push_dir(&mut dirs, appdata.join("npm"));
        // nvm-windows 的默认位置：%APPDATA%\nvm\<版本>\
        let nvm = appdata.join("nvm");
        push_dir(&mut dirs, nvm.clone());
        push_child_dirs(&mut dirs, &nvm, None);
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        push_dir(&mut dirs, local.join("pnpm"));
        push_dir(&mut dirs, local.join("Programs"));
        push_dir(&mut dirs, local.join("Volta").join("bin"));
        push_dir(&mut dirs, local.join("Yarn").join("bin"));
        push_dir(&mut dirs, local.join("Microsoft").join("WindowsApps"));
    }

    // 包管理器自己报的位置
    if let Some(dir) = env_dir("PNPM_HOME") {
        push_dir(&mut dirs, dir);
    }
    if let Some(dir) = env_dir("VOLTA_HOME") {
        push_dir(&mut dirs, dir.join("bin"));
    }
    if let Some(dir) = env_dir("NVM_SYMLINK") {
        push_dir(&mut dirs, dir);
    }
    if let Some(dir) = env_dir("SCOOP") {
        push_dir(&mut dirs, dir.join("shims"));
    }
    if let Some(dir) = env_dir("SCOOP_GLOBAL") {
        push_dir(&mut dirs, dir.join("shims"));
    }
    // nvm-windows：$NVM_HOME 下的每个 node 版本目录里都有 bin
    if let Some(dir) = env_dir("NVM_HOME") {
        push_dir(&mut dirs, dir.clone());
        push_child_dirs(&mut dirs, &dir, None);
    }

    push_dir(&mut dirs, home.join(".bun").join("bin"));
    push_dir(&mut dirs, home.join(".cargo").join("bin"));
    push_dir(&mut dirs, home.join(".local").join("bin"));
    push_dir(&mut dirs, home.join(".npm-global").join("bin"));
    push_dir(&mut dirs, home.join("n").join("bin"));
    push_dir(&mut dirs, home.join("scoop").join("shims"));
    push_dir(&mut dirs, home.join(".volta").join("bin"));
    push_dir(&mut dirs, home.join("go").join("bin"));
    push_dir(&mut dirs, home.join("bin"));

    // mise：shims + 每个 node 安装的 bin
    let mise = home.join(".local").join("share").join("mise");
    push_dir(&mut dirs, mise.join("shims"));
    push_child_dirs(&mut dirs, &mise.join("installs").join("node"), Some("bin"));

    // fnm：每个 multishell 目录下的 bin
    push_child_dirs(
        &mut dirs,
        &home.join(".local").join("state").join("fnm_multishells"),
        Some("bin"),
    );

    // nvm（unix 布局）：~/.nvm/versions/node/<版本>/bin
    push_child_dirs(
        &mut dirs,
        &home.join(".nvm").join("versions").join("node"),
        Some("bin"),
    );

    dirs
}

/// 搜索目录：PATH 优先（第一个命中 = 命令行默认那处），再是工具专属与兜底目录。
fn search_dirs(paths: &Paths, command: &str) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    // PATH 优先：第一个命中的就是命令行默认用的那处
    for dir in path_dirs() {
        push_dir(&mut dirs, dir);
    }
    for dir in tool_extra_dirs(paths, command) {
        push_dir(&mut dirs, dir);
    }
    for dir in fallback_dirs(paths) {
        push_dir(&mut dirs, dir);
    }
    dirs
}

/// 某个目录下的可执行文件候选。
///
/// Windows 上 npm / pnpm / yarn 装包时会同时写三个入口：
/// `foo`（POSIX shim）、`foo.cmd`、`foo.ps1` —— 它们是**同一处安装**。
/// 只留 `.cmd` / `.exe` 那份（命令行真正会命中的），不然一处安装会被数成两三处。
///
/// `.bat` 同理：同目录下已经有 `.cmd` / `.exe` 时它就是被遮住的另一个入口。
#[cfg(target_os = "windows")]
fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
    let cmd = dir.join(format!("{command}.cmd"));
    let exe = dir.join(format!("{command}.exe"));
    let mut candidates = vec![cmd.clone(), exe.clone()];

    if !has_windows_launcher_sibling(&cmd, &exe) {
        candidates.push(dir.join(format!("{command}.bat")));
        candidates.push(dir.join(command));
    }
    candidates
}

/// 同目录下有没有 Windows 命令行真正会命中的入口（`.cmd` / `.exe`）。
#[cfg(target_os = "windows")]
fn has_windows_launcher_sibling(cmd: &Path, exe: &Path) -> bool {
    cmd.is_file() || exe.is_file()
}

#[cfg(not(target_os = "windows"))]
fn executable_candidates(dir: &Path, command: &str) -> Vec<PathBuf> {
    vec![dir.join(command)]
}

/// App Execution Alias 是 0 字节的跳转桩，跑起来没意义（还会误触发协议处理器）。
#[cfg(target_os = "windows")]
fn is_app_execution_alias(path: &Path) -> bool {
    path.to_string_lossy().contains("WindowsApps")
}

#[cfg(not(target_os = "windows"))]
fn is_app_execution_alias(_path: &Path) -> bool {
    false
}

// ---------------------------------------------------------------- 探测

/// 跑一次 `--version`，拿 stdout/stderr 里的版本号。
fn run_version(path: &Path) -> Result<Option<String>, String> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动失败：{e}"))?;

    let deadline = Instant::now() + PROBE_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return Err(format!("执行超时（{} 秒）", PROBE_TIMEOUT.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(e) => return Err(format!("等待进程失败：{e}")),
        }
    };

    let output = child
        .wait_with_output()
        .map_err(|e| format!("读取输出失败：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if status.success() {
        let raw = if stdout.is_empty() { &stderr } else { &stdout };
        if raw.is_empty() {
            return Err("`--version` 没有输出".to_string());
        }
        Ok(extract_version(raw))
    } else {
        let detail = if stderr.is_empty() { stdout } else { stderr };
        if detail.is_empty() {
            Err(format!("`--version` 以 {} 退出且没有输出", status.code().unwrap_or(-1)))
        } else {
            Err(last_lines(&detail, 3))
        }
    }
}

/// 从输出里挑出版本号（`2.1.311` / `v0.8.0` 这类）。
fn extract_version(raw: &str) -> Option<String> {
    let chars: Vec<char> = raw.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        let mut token = String::new();
        let mut cursor = index;
        if chars[cursor] == 'v' || chars[cursor] == 'V' {
            token.push(chars[cursor]);
            cursor += 1;
        }
        if cursor < chars.len() && chars[cursor].is_ascii_digit() {
            while cursor < chars.len()
                && (chars[cursor].is_ascii_digit()
                    || chars[cursor] == '.'
                    || chars[cursor] == '-'
                    || chars[cursor] == '+')
            {
                token.push(chars[cursor]);
                cursor += 1;
            }
            let trimmed = token.trim_end_matches(['.', '-', '+']);
            if trimmed.contains('.') && trimmed.chars().any(|c| c.is_ascii_digit()) {
                return Some(trimmed.to_string());
            }
        }
        index += 1;
    }
    None
}

/// 取末尾几行。
fn last_lines(text: &str, count: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
    lines
        .iter()
        .rev()
        .take(count)
        .rev()
        .cloned()
        .collect::<Vec<&str>>()
        .join(" / ")
}

/// 找出一个命令的全部候选可执行文件（纯文件系统，不启动任何进程）。
///
/// PATH 里的排前面 —— 那是用户真正在终端敲的那个。
/// 软链 / 同一真身只算一处（canonicalize 去重）。
fn find_candidates(paths: &Paths, command: &str) -> Vec<PathBuf> {
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut candidates: Vec<PathBuf> = Vec::new();

    for dir in search_dirs(paths, command) {
        for candidate in executable_candidates(&dir, command) {
            if !candidate.is_file() || is_app_execution_alias(&candidate) {
                continue;
            }
            let real = candidate.canonicalize().unwrap_or_else(|_| candidate.clone());
            if seen.contains(&real) {
                continue;
            }
            seen.push(real);
            candidates.push(candidate);
        }
    }
    candidates
}

/// 探一个候选：跑一次 `--version`。
fn probe_one_path(candidate: &Path) -> (Option<String>, bool, Option<String>) {
    match run_version(candidate) {
        Ok(version) => (version, true, None),
        Err(error) => (None, false, Some(error)),
    }
}

/// 主扫描：每个工具只跑**一次** `--version`（PATH 命中的那处）。
///
/// 抄 cc-switch 的 `probe_path_default_version`：先探 PATH 解析到的那份，
/// 只有它确实找不到才去兜底目录扫。全部候选都跑版本号是 cc-switch 的
/// 「安装位置诊断」那一步的活，不该压在每次扫描上。
fn probe_command(paths: &Paths, command: &str) -> (Vec<AgentInstall>, Option<AgentInstall>) {
    let candidates = find_candidates(paths, command);
    let mut installs: Vec<AgentInstall> = Vec::new();

    for (index, candidate) in candidates.iter().enumerate() {
        // 第一处（PATH 优先）跑版本号，其余先只记路径。
        let (version, runnable, error) = if index == 0 {
            probe_one_path(candidate)
        } else {
            (None, true, None)
        };
        installs.push(AgentInstall {
            path: candidate.to_string_lossy().to_string(),
            version,
            runnable,
            error,
            source: infer_source(candidate),
            is_path_default: index == 0,
        });
    }

    let primary = installs
        .iter()
        .find(|item| item.is_path_default)
        .or_else(|| installs.first())
        .cloned();
    (installs, primary)
}

/// 按需枚举某工具的**全部**安装位置（每一处都跑 `--version`）。
///
/// 这是 cc-switch 的 `enumerate_tool_installations`：只有用户真的展开
/// 「另有 N 处安装」时才做，不占主扫描的时间。
pub async fn toolbox_installations(paths: &Paths, command: String) -> Result<Vec<AgentInstall>, String> {
    Ok({
        let candidates = find_candidates(paths, &command);
        let mut installs: Vec<AgentInstall> = Vec::new();
        for (index, candidate) in candidates.iter().enumerate() {
            let (version, runnable, error) = probe_one_path(candidate);
            installs.push(AgentInstall {
                path: candidate.to_string_lossy().to_string(),
                version,
                runnable,
                error,
                source: infer_source(candidate),
                is_path_default: index == 0,
            });
        }
        installs
    })
}

/// 探测本机所有已知的 CLI agent。
pub async fn toolbox_scan(paths: &Paths) -> Result<Vec<AgentInfo>, String> {
    // 探测会跑外部进程，放到阻塞线程池，别卡住 UI。
    let agents = {
        let specs: Vec<(&str, &str)> = AGENT_SPECS.to_vec();
        std::thread::scope(|scope| {
            let handles: Vec<_> = specs
                .iter()
                .map(|(command, name)| scope.spawn(|| probe_one(paths, command, name)))
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap_or_else(|_| AgentInfo {
                    id: String::new(),
                    name: String::new(),
                    command: String::new(),
                    installed: false,
                    version: None,
                    path: None,
                    error: Some("探测线程异常".to_string()),
                    installs: Vec::new(),
                    package: None,
                    source: String::new(),
                    latest_version: None,
                }))
                .collect::<Vec<AgentInfo>>()
        })
    };

    // 注意：**不**在这里查 registry 的最新版本。
    // npm registry 在慢网络下单个包要 3~20 秒，挡在扫描里等于卡死界面。
    // 最新版本由 `agents_check_updates` 单独异步查，结果晚到也没关系。
    Ok(agents)
}

/// 某个工具的最新版本。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LatestVersion {
    /// 命令名。
    pub command: String,
    /// registry 上的最新版本；查不到时为空。
    pub latest_version: Option<String>,
}

/// 查本地已装工具的最新版本（并发、单独调用，不挡扫描）。
///
/// 只查传进来的那些命令 —— 没装的东西没必要去 registry 问一趟，
/// 白等好几秒还可能把 registry 打到限流。
pub async fn toolbox_check_updates(
    paths: &Paths,
    commands: Vec<String>,
) -> Result<Vec<LatestVersion>, String> {
    let mut results = Vec::with_capacity(commands.len());
    for command in commands {
        let Some(package) = npm_package_for(&command).map(|value| value.to_string()) else {
            continue;
        };
        let latest = fetch_latest_version(paths, &package).await;
        results.push(LatestVersion {
            command,
            latest_version: latest,
        });
    }
    Ok(results)
}

/// 探测单个命令并整理成 AgentInfo。
fn probe_one(paths: &Paths, command: &str, name: &str) -> AgentInfo {
    let (installs, primary) = probe_command(paths, command);

    AgentInfo {
        id: command.to_string(),
        name: name.to_string(),
        command: command.to_string(),
        installed: !installs.is_empty(),
        version: primary.as_ref().and_then(|item| item.version.clone()),
        path: primary.as_ref().map(|item| item.path.clone()),
        error: primary.as_ref().and_then(|item| item.error.clone()),
        source: primary.map(|item| item.source).unwrap_or_default(),
        installs,
        package: npm_package_for(command).map(|value| value.to_string()),
        latest_version: None,
    }
}

/// 查 npm registry 上的最新版本（`dist-tags.latest`）。
///
/// 抄 cc-switch 的 `fetch_npm_latest_for_tool`：单请求取整个 dist-tags，
/// 超时短（15 秒），查不到就当没有新版本，不阻塞界面。
/// registry 候选：官方源优先，不通再试 npmmirror。
const REGISTRIES: &[&str] = &[
    "https://registry.npmjs.org",
    "https://registry.npmmirror.com",
];

/// 代理地址：先用全局设置（系统设置 › 网络），再看环境变量。
///
/// 都没配时，沿用旧启发式：先试本机常见代理端口（Clash / v2rayN 默认 7897）——
/// 不走代理时 registry 在国内要 20 秒以上，走代理实测能快 4~5 倍。
///
/// 用户在界面里明确选了「直连」时就不再试本机端口了。
fn proxy_url(paths: &Paths) -> Option<String> {
    match crate::proxy::resolve(paths) {
        crate::proxy::Resolved {
            url: Some(url), ..
        } => Some(url),
        crate::proxy::Resolved {
            url: None,
            source: crate::proxy::ProxySource::Settings,
        } => None,
        _ => Some("http://127.0.0.1:7897".to_string()),
    }
}

/// 建一个 HTTP 客户端。`with_proxy` 为 false 时明确直连（绕开环境里的代理）。
fn http_client(paths: &Paths, with_proxy: bool) -> Option<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        // 慢网络下等太久界面就卡住了；拿不到就当「查不到更新」。
        .timeout(Duration::from_secs(8))
        .user_agent("AgentSpace/0.1");
    if with_proxy {
        let proxy = proxy_url(paths)?;
        builder = builder.proxy(reqwest::Proxy::all(proxy).ok()?);
    } else {
        builder = builder.no_proxy();
    }
    builder.build().ok()
}

/// 查某个包在 registry 上的最新版本。
///
/// 走 `/<pkg>/latest` 端点：只返回 latest 那一个版本的清单（几 KB），
/// 而 `/<pkg>` 返回整个 packument（几 MB）—— 实测差 40 倍。
async fn fetch_latest_version(paths: &Paths, package: &str) -> Option<String> {
    let encoded = package.replace('/', "%2f");
    let proxy_client = http_client(paths, true);
    let direct_client = http_client(paths, false);

    for base in REGISTRIES {
        let url = format!("{base}/{encoded}/latest");
        for client in [proxy_client.as_ref(), direct_client.as_ref()]
            .into_iter()
            .flatten()
        {
            let response = match client.get(&url).send().await {
                Ok(response) => response,
                Err(_) => continue,
            };
            if !response.status().is_success() {
                continue;
            }
            let json: serde_json::Value = match response.json().await {
                Ok(json) => json,
                Err(_) => continue,
            };
            // /latest 返回的是单个版本清单，版本号在顶层。
            let version = json
                .get("version")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
                .or_else(|| {
                    json.get("dist-tags")?
                        .get("latest")?
                        .as_str()
                        .map(|value| value.to_string())
                });
            if let Some(version) = version {
                return Some(version);
            }
        }
    }
    None
}

/// 包操作方案：跑什么命令。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PackagePlan {
    /// 命令名（claude / codex …）。
    pub command: String,
    /// 展示名。
    pub name: String,
    /// npm 包名。
    pub package: String,
    /// 包管理器：npm / pnpm / bun / volta。
    pub manager: String,
    /// 实际执行的命令（给人看的）。
    pub command_line: String,
    /// 升级 / 卸载的目标安装路径；安装时为空。
    pub path: String,
    /// 实际执行的程序（一般是包管理器的绝对路径）。
    pub program: String,
    /// 实际执行的参数。
    pub args: Vec<String>,
    /// 装/升的版本（默认 latest）。
    pub version: String,
}

/// 要对一个包做什么。
#[derive(Clone, Copy, PartialEq)]
enum Op {
    /// 装 / 升（npm 看来是同一条命令）。
    Add,
    /// 卸。
    Remove,
}

/// 包管理器命令：程序 + 参数。
struct PackageCommand {
    manager: String,
    program: String,
    args: Vec<String>,
}

/// 由安装来源推导用哪个包管理器、跑什么。
///
/// 抄 cc-switch 的思路：只有 volta / pnpm / bun 算「专属管理器」，
/// 其余一律用 npm（nvm / fnm / mise 里的全局包本来就是 npm 装的）。
/// homebrew / scoop / pipx 装的不是 npm 包，升不了，让用户自己弄。
fn package_command(
    command: &str,
    target: &AgentInstall,
    package: &str,
    op: Op,
) -> Result<PackageCommand, String> {
    // 有些包只能由特定包管理器装/升（omp 只能由 bun 跑）
    if let Some(required) = required_manager(command) {
        if target.source != required {
            return Err(format!(
                "这个工具只能用 {required} 安装/升级（当前这处是 {} 装的）",
                target.source
            ));
        }
    }

    let target_path = PathBuf::from(&target.path);
    let latest = format!("{package}@latest");

    // 包管理器都把自己的 cli 跟它装的命令放同一个 bin 目录，
    // 从那儿推导出来的绝对路径才是同一套 node 安装。
    let sibling = |name: &str, exts: &[&str]| -> String {
        sibling_binary(&target_path, name, exts)
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| name.to_string())
    };

    let command = match target.source.as_str() {
        "volta" => PackageCommand {
            manager: "volta".to_string(),
            program: sibling("volta", &["exe", "cmd"]),
            args: match op {
                Op::Remove => vec!["uninstall".to_string(), package.to_string()],
                Op::Add => vec!["install".to_string(), package.to_string()],
            },
        },
        "pnpm" => PackageCommand {
            manager: "pnpm".to_string(),
            program: sibling("pnpm", &["cmd", "exe"]),
            args: match op {
                Op::Remove => vec!["remove".to_string(), "-g".to_string(), package.to_string()],
                Op::Add => vec!["add".to_string(), "-g".to_string(), latest.clone()],
            },
        },
        "bun" => PackageCommand {
            manager: "bun".to_string(),
            program: sibling("bun", &["exe", "cmd"]),
            args: match op {
                Op::Remove => vec!["remove".to_string(), "-g".to_string(), package.to_string()],
                Op::Add => vec!["add".to_string(), "-g".to_string(), latest.clone()],
            },
        },
        "homebrew" | "scoop" | "pipx" => {
            return Err(format!(
                "这个工具是通过 {} 安装的，不支持自动操作，请手动处理",
                target.source
            ));
        }
        _ => PackageCommand {
            manager: "npm".to_string(),
            program: sibling("npm", &["cmd", "exe"]),
            args: match op {
                Op::Remove => vec!["uninstall".to_string(), "-g".to_string(), package.to_string()],
                Op::Add => vec!["install".to_string(), "-g".to_string(), latest.clone()],
            },
        },
    };
    Ok(command)
}

/// PATH 上的包管理器（npm / bun）。
///
/// 安装时还没有目标安装，只能从 PATH 里找包管理器
/// （找不到就退回 PATH 上的命令名）。
fn manager_in_path(name: &str) -> Option<String> {
    for dir in path_dirs() {
        for ext in ["cmd", "exe"] {
            let candidate = dir.join(format!("{name}.{ext}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// 安装方案：还没装，所以没有目标安装可参考，只能用 PATH 上的包管理器。
fn install_plan_for(_paths: &Paths, command: &str, name: &str, version: &str) -> Result<PackagePlan, String> {
    let package = npm_package_for(command)
        .ok_or_else(|| format!("{name} 不是通过 npm 分发的，无法自动安装"))?
        .to_string();
    // 有些包只能由特定包管理器装（omp 只能由 bun 跑）
    let manager = required_manager(command).unwrap_or("npm");
    let program = manager_in_path(manager).unwrap_or_else(|| manager.to_string());
    let args = match manager {
        "bun" => vec!["add".to_string(), "-g".to_string(), format!("{package}@{version}")],
        _ => vec![
            "install".to_string(),
            "-g".to_string(),
            format!("{package}@{version}"),
        ],
    };
    let command_line = format!("{} {}", program, args.join(" "));
    Ok(PackagePlan {
        command: command.to_string(),
        name: name.to_string(),
        package,
        manager: manager.to_string(),
        command_line,
        path: String::new(),
        program,
        args,
        version: version.to_string(),
    })
}

/// 升级方案：对着已装的那处升（版本固定用 latest）。
fn upgrade_plan_for(paths: &Paths, command: &str, name: &str) -> Result<PackagePlan, String> {
    let package = npm_package_for(command)
        .ok_or_else(|| format!("{name} 不是通过 npm 分发的，无法自动升级"))?
        .to_string();
    let target = target_install(paths, command, name)?;
    let cmd = package_command(command, &target, &package, Op::Add)?;
    Ok(PackagePlan {
        command: command.to_string(),
        name: name.to_string(),
        package,
        manager: cmd.manager,
        command_line: format!("{} {}", cmd.program, cmd.args.join(" ")),
        path: target.path.clone(),
        program: cmd.program,
        args: cmd.args,
        version: "latest".to_string(),
    })
}

/// 卸载方案：卸掉已装的那处。
fn uninstall_plan_for(paths: &Paths, command: &str, name: &str) -> Result<PackagePlan, String> {
    let package = npm_package_for(command)
        .ok_or_else(|| format!("{name} 不是通过 npm 分发的，无法自动卸载"))?
        .to_string();
    let target = target_install(paths, command, name)?;
    let cmd = package_command(command, &target, &package, Op::Remove)?;
    let command_line = format!("{} {}", cmd.program, cmd.args.join(" "));
    Ok(PackagePlan {
        command: command.to_string(),
        name: name.to_string(),
        package,
        manager: cmd.manager,
        command_line,
        path: target.path.clone(),
        program: cmd.program,
        args: cmd.args,
        version: "latest".to_string(),
    })
}

/// 找到要操作的那处安装（PATH 命中的那处）。
fn target_install(paths: &Paths, command: &str, name: &str) -> Result<AgentInstall, String> {
    let (installs, default_target) = probe_command(paths, command);
    default_target
        .or_else(|| installs.first().cloned())
        .ok_or_else(|| format!("未检测到 {name} 的安装"))
}

/// 包操作方案：前端拿它去展示「将要执行什么」。
///
/// op：install / upgrade / uninstall；version：装哪个版本（空 = latest）。
pub fn toolbox_package_plan(
    paths: &Paths,
    command: String,
    op: String,
    version: Option<String>,
) -> Result<PackagePlan, String> {
    let name = AGENT_SPECS
        .iter()
        .find(|(cmd, _)| *cmd == command)
        .map(|(_, name)| *name)
        .unwrap_or("该工具");
    let version = version
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "latest".to_string());
    match op.as_str() {
        "install" => install_plan_for(paths, &command, name, &version),
        "upgrade" => upgrade_plan_for(paths, &command, name),
        "uninstall" => uninstall_plan_for(paths, &command, name),
        other => Err(format!("未知的操作：{other}")),
    }
}

/// 某个包能装的版本（新 → 旧）。
///
/// 走 `npm view <pkg> versions --json` —— 比直接拉 registry 的 packument 轻得多
/// （后者对 claude-code 有好几 MB）。
pub async fn toolbox_package_versions(
    _paths: &Paths,
    command: String,
) -> Result<Vec<String>, String> {
    let package = npm_package_for(&command)
        .ok_or_else(|| format!("{command} 不是通过 npm 分发的，没有可安装版本"))?
        .to_string();
    let npm = manager_in_path("npm").unwrap_or_else(|| "npm".to_string());
    let npm_name = npm.clone();
    let output = Command::new(&npm)
        .args(["view", &package, "versions", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("执行 {npm_name} 失败：{e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("{npm_name} view 退出码 {}", output.status.code().unwrap_or(-1))
        } else {
            format!("读取版本列表失败：{}", last_lines(&stderr, 2))
        });
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // 只有一个版本时 npm 返回的是字符串，不是数组。
    let versions: Vec<String> = if let Ok(list) = serde_json::from_str::<Vec<String>>(&raw) {
        list
    } else if let Ok(one) = serde_json::from_str::<String>(&raw) {
        vec![one]
    } else {
        Vec::new()
    };

    // 新的在前；只留最近的一批，够选了。
    Ok(versions
        .into_iter()
        .rev()
        .take(60)
        .collect::<Vec<String>>()
        .into_iter()
        .collect())
}

/// 跑一条包管理器命令。返回执行结果，失败时给出人话提示。
async fn run_package_command(plan: &PackagePlan, verb: &str) -> Result<(), String> {
    let program = plan.program.clone();
    let program_name = program.clone();
    let args = plan.args.clone();
    let output = {
        Command::new(&program)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("执行 {program_name} 失败：{e}"))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        if detail.is_empty() {
            return Err(format!(
                "{program_name} 以 {} 退出",
                output.status.code().unwrap_or(-1)
            ));
        }
        let mut message = format!("{verb}失败：{}", last_lines(&detail, 4));
        // 报错只是一堆 npm 的英文堆栈 —— 补一句人话，省得用户自己去查。
        if let Some(hint) = failure_hint(&detail) {
            message.push_str(&format!("（{hint}）"));
        }
        return Err(message);
    }
    Ok(())
}

/// 安装：跑包管理器的全局安装。
///
/// version：装哪个版本（空 = latest）。
pub async fn toolbox_install(
    paths: &Paths,
    command: String,
    version: Option<String>,
) -> Result<String, String> {
    let name = AGENT_SPECS
        .iter()
        .find(|(cmd, _)| *cmd == command)
        .map(|(_, name)| *name)
        .unwrap_or("该工具");
    let version = version
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "latest".to_string());
    let plan = install_plan_for(paths, &command, name, &version)?;
    run_package_command(&plan, "安装").await?;

    // 装完了不等于能用：再探一次，真能跑才算装好。
    let (installs, primary) = probe_command(paths, &command);
    match primary {
        Some(install) => {
            let version = install.version.clone().unwrap_or_default();
            if install.runnable {
                Ok(if version.is_empty() {
                    plan.command_line
                } else {
                    format!("{}（当前版本 {version}）", plan.command_line)
                })
            } else {
                Err(format!(
                    "安装命令跑完了，但 {name} 现在跑不起来：{}",
                    install.error.unwrap_or_default()
                ))
            }
        }
        None if installs.is_empty() => Err(format!(
            "安装命令跑完了，但仍然找不到 {name}（可能装到了别的目录）"
        )),
        None => Err(format!("安装命令跑完了，但 {name} 仍然不可用")),
    }
}

/// 执行升级：跑包管理器的全局安装。
pub async fn toolbox_upgrade(paths: &Paths, command: String) -> Result<String, String> {
    let name = AGENT_SPECS
        .iter()
        .find(|(cmd, _)| *cmd == command)
        .map(|(_, name)| *name)
        .unwrap_or("该工具");
    let plan = upgrade_plan_for(paths, &command, name)?;
    run_package_command(&plan, "升级").await?;

    // 装完了不等于能用。
    //
    // Windows 上正在运行的 exe 换不掉（npm 的 postinstall 会失败）、
    // 平台二进制没装上、装成了别的架构 —— 这些都会留下一个
    // 「装上了但跑不起来」的 claude，而 npm 的退出码照样是 0。
    let target = PathBuf::from(&plan.path);
    match run_version(&target) {
        Ok(Some(version)) => Ok(format!("{}（当前版本 {version}）", plan.command_line)),
        // 跑起来了，只是没解析出版本号 —— 不算失败。
        Ok(None) => Ok(plan.command_line),
        Err(error) => {
            let mut message = format!("升级命令跑完了，但 {name} 现在跑不起来：{error}");
            if let Some(hint) = failure_hint(&error) {
                message.push_str(&format!("（{hint}）"));
            }
            Err(message)
        }
    }
}

/// 卸载：把已装的那处卸掉。
pub async fn toolbox_uninstall(paths: &Paths, command: String) -> Result<String, String> {
    let name = AGENT_SPECS
        .iter()
        .find(|(cmd, _)| *cmd == command)
        .map(|(_, name)| *name)
        .unwrap_or("该工具");
    let plan = uninstall_plan_for(paths, &command, name)?;
    run_package_command(&plan, "卸载").await?;

    // 卸掉了么？再探一次 —— 还在就是没卸干净。
    let (installs, _) = probe_command(paths, &command);
    if installs.is_empty() {
        Ok(plan.command_line)
    } else {
        Ok(format!(
            "{}（已卸载，但别处还有 {} 处安装）",
            plan.command_line,
            installs.len()
        ))
    }
}

/// 把常见的报错翻译成一句能直接照做的提示。
fn failure_hint(detail: &str) -> Option<&'static str> {
    let lower = detail.to_lowercase();
    if lower.contains("eperm")
        || lower.contains("ebusy")
        || lower.contains("resource busy")
        || lower.contains("being used by another process")
        || lower.contains("cannot replace")
    {
        Some("文件被占用了：Windows 不允许替换正在运行的可执行文件，先把正在跑的 CLI 关掉再升")
    } else if lower.contains("postinstall")
        || lower.contains("install.cjs")
        || lower.contains("not a valid win32")
        || lower.contains("不是有效的 win32")
        || lower.contains("not compatible with the version of windows")
    {
        Some("平台二进制没装上（npm 的 postinstall 没跑成）：关掉正在运行的 CLI 后重装一次")
    } else if lower.contains("eacces")
        || lower.contains("permission denied")
        || lower.contains("access is denied")
    {
        Some("多半是全局目录权限不够：用管理员权限的终端跑，或换个 npm 全局目录（npm config set prefix）")
    } else if lower.contains("enotfound")
        || lower.contains("econnrefused")
        || lower.contains("etimedout")
        || lower.contains("network")
    {
        Some("多半是网络或 registry 不通：检查代理设置与镜像源")
    } else if lower.contains("is not recognized")
        || lower.contains("command not found")
        || lower.contains("no such file")
    {
        Some("多半是包管理器不在 PATH 上")
    } else {
        None
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    /// Windows 上 npm 装包会写 `foo`（POSIX shim）+ `foo.cmd` 两个入口 ——
    /// 同一处安装，不能数成两处。
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_候选里_npm_shim_只算一处() {
        let dir = std::env::temp_dir().join("agent-compose-candidates-npm");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("mcode"), "#!/bin/sh\n").unwrap();
        std::fs::write(dir.join("mcode.cmd"), "@echo off\n").unwrap();

        let candidates = executable_candidates(&dir, "mcode");
        // 无扩展名那个被 .cmd 遮住 → 不进候选
        assert!(!candidates.contains(&dir.join("mcode")));
        assert!(candidates.contains(&dir.join("mcode.cmd")));

        let existing: Vec<_> = candidates.iter().filter(|p| p.is_file()).collect();
        assert_eq!(existing.len(), 1);
    }

    /// 只有无扩展名那个入口时（Unix 风格安装）照旧认。
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_候选保留_唯一的无扩展名入口() {
        let dir = std::env::temp_dir().join("agent-compose-candidates-unix");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("foo"), "#!/bin/sh\n").unwrap();

        let candidates = executable_candidates(&dir, "foo");
        assert!(candidates.contains(&dir.join("foo")));
    }

    /// nvm 这类「根目录下面每个版本一个子目录」的布局：版本目录必须展开，
    /// 否则只能看见根目录，看不见各个版本里装的东西（claude 就是这么漏的）。
    #[test]
    fn expands_version_subdirs() {
        let root = std::env::temp_dir().join("agent-compose-child-dirs");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("v22.22.2")).unwrap();
        std::fs::create_dir_all(root.join("v24.21.0")).unwrap();
        std::fs::create_dir_all(root.join("not-a-dir")).unwrap();
        std::fs::write(root.join("not-a-dir").join("x"), "").unwrap();

        let mut dirs: Vec<PathBuf> = Vec::new();
        push_child_dirs(&mut dirs, &root, None);

        assert!(dirs.contains(&root.join("v22.22.2")));
        assert!(dirs.contains(&root.join("v24.21.0")));
        // 不存在的后缀目录不加
        let mut with_suffix: Vec<PathBuf> = Vec::new();
        push_child_dirs(&mut with_suffix, &root, Some("bin"));
        assert!(with_suffix.is_empty());
    }

    #[test]
    fn compares_versions() {
    }
}
