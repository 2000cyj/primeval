//! 应用自身的版本检测。
//!
//! 做法参考 cc-switch：问远端「最新版本是多少」，比本地版本新就提示更新。
//!
//! cc-switch 用的是 Tauri 官方 updater 插件 —— 那条路要先有 minisign 密钥对、
//! CI 里签名、还要额外产出 `latest.json` 和 `.nsis.zip`。我们 Windows 包目前
//! 没签名体系，所以这里只做**检测**：
//!
//! - 查 GitHub 的 latest release，拿 tag / 说明 / 附件
//! - 跟当前版本比
//! - 顺手把 Windows 安装包和便携版的附件地址挑出来，交给调用方去下载
//!
//! 以后要「点一下就自动装」，再上 Tauri updater 插件，检测这层不用改。

use serde::{Deserialize, Serialize};

/// 发版仓库。
pub const REPO_OWNER: &str = "2000cyj";

/// 发版仓库名。
pub const REPO_NAME: &str = "primeval";

/// GitHub API 的 latest release（兼底用）。
pub const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/2000cyj/primeval/releases/latest";

/// 静态版本清单（首选）。
///
/// 走 release 附件下载，**不受 GitHub API 的 60 次/小时限流影响** ——
/// 那个限流是按 IP 算的，共享网络里很容易被打满，检测功能会时好时坏。
/// CI 里每次发版都会把最新的 `latest.json` 作为附件挂上去。
pub const LATEST_JSON_URL: &str =
    "https://github.com/2000cyj/primeval/releases/latest/download/latest.json";

/// 版本清单的候选地址，按优先级排。
///
/// 全是自动维护的 —— 没有需要人工同步的东西。
/// 手动维护的清单会过期，一过期就会把真实版本号挡住，
/// 用户再也看不到更新提示。
pub const LATEST_JSON_URLS: [&str; 1] = [LATEST_JSON_URL];

/// 用环境变量改写版本清单地址。
///
/// 自建更新源、或者本地拿个静态文件试的时候用。
pub const UPDATE_MANIFEST_ENV: &str = "AGENTSPACE_UPDATE_MANIFEST_URL";

/// 版本清单的候选地址。
///
/// 环境变量里指定了就只用它，否则用内置的。
pub fn latest_json_urls() -> Vec<String> {
    if let Ok(custom) = std::env::var(UPDATE_MANIFEST_ENV) {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return vec![trimmed.to_string()];
        }
    }
    LATEST_JSON_URLS.iter().map(|url| url.to_string()).collect()
}

/// release 页面（检测不到 API 时的兜底，也给用户点「查看发布说明」用）。
pub const RELEASE_PAGE: &str = "https://github.com/2000cyj/primeval/releases/latest";

/// GitHub 的 release 订阅源（Atom）。
///
/// 公开的 XML feed，**不走 API、不受那个 60 次/小时的限流约束** ——
/// 那个限流按 IP 算，共享网络里很容易被打满，检测功能会时好时坏。
///
/// 拿得到：版本号、发布时间、发布说明、发布页地址。
/// 拿不到：附件直链 —— 那要靠 latest.json 或 API。
pub const RELEASES_ATOM_URL: &str = "https://github.com/2000cyj/primeval/releases.atom";

/// 检测结果。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// 当前版本（本地应用版本）。
    pub current_version: String,
    /// 远端最新版本，不带 `v` 前缀。
    pub latest_version: String,
    /// 远端最新版本是不是比当前新。
    pub has_update: bool,
    /// 新版本的发布说明（Release 正文）。
    pub notes: String,
    /// 新版本发布日期。
    pub published_at: String,
    /// Release 页面地址。
    pub release_url: String,
    /// Windows 安装包地址（有就填）。
    pub download_url: String,
    /// 便携版地址（有就填）。
    pub portable_url: String,
}

/// GitHub 返回的 release 里我们关心的几个字段。
#[derive(Debug, Deserialize)]
struct GithubRelease {
    #[serde(default)]
    tag_name: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    published_at: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

/// release 里的一个附件。
#[derive(Debug, Deserialize)]
struct GithubAsset {
    #[serde(default)]
    name: String,
    #[serde(default)]
    browser_download_url: String,
}

/// 静态版本清单 —— CI 发版时生成，作为 release 附件挂上去。
#[derive(Debug, Deserialize)]
struct LatestJson {
    #[serde(default)]
    version: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    pub_date: String,
    #[serde(default)]
    download_url: String,
    #[serde(default)]
    portable_url: String,
    #[serde(default)]
    release_url: String,
}

/// 拉 GitHub 的 latest release，算出检测结果。
///
/// 依次尝试：
/// 1. 静态清单（release 附件 / 仓库里的那份）—— 最全，有附件直链
/// 2. release 订阅源（Atom）—— 不受限流，有版本号和发布说明
/// 3. GitHub API —— 最全，但有限流
pub async fn check_latest_release(current_version: &str) -> Result<UpdateInfo, String> {
    let mut errors = Vec::new();

    match fetch_latest_json().await {
        Ok(info) => return Ok(info.into_update_info(current_version)),
        Err(err) => errors.push(err),
    }

    match fetch_latest_atom().await {
        Ok(info) => return Ok(info.into_update_info(current_version)),
        Err(err) => errors.push(err),
    }

    match fetch_latest_release().await {
        Ok(release) => {
            let latest_version = release.tag_name.trim().trim_start_matches('v').to_string();
            if latest_version.is_empty() {
                return Err("远端没有给出版本号".to_string());
            }
            let (download_url, portable_url) = pick_windows_assets(&release.assets);
            Ok(UpdateInfo {
                has_update: is_newer(&latest_version, current_version),
                current_version: current_version.to_string(),
                latest_version,
                notes: release.body,
                published_at: release.published_at,
                release_url: if release.html_url.is_empty() {
                    RELEASE_PAGE.to_string()
                } else {
                    release.html_url
                },
                download_url,
                portable_url,
            })
        }
        Err(err) => {
            errors.push(err);
            Err(errors.join("；"))
        }
    }
}

/// 静态清单转成检测结果。
impl LatestJson {
    fn into_update_info(self, current_version: &str) -> UpdateInfo {
        let latest_version = self.version.trim().trim_start_matches('v').to_string();
        UpdateInfo {
            has_update: is_newer(&latest_version, current_version),
            current_version: current_version.to_string(),
            latest_version,
            notes: self.notes,
            published_at: self.pub_date,
            release_url: if self.release_url.is_empty() {
                RELEASE_PAGE.to_string()
            } else {
                self.release_url
            },
            download_url: self.download_url,
            portable_url: self.portable_url,
        }
    }
}

/// Atom feed 里的一条 release。
#[derive(Debug, Default)]
struct AtomEntry {
    /// 发布页地址。
    link: String,
    /// 发布时间。
    updated: String,
    /// 正文（HTML）。
    content: String,
}

impl AtomEntry {
    /// 从发布页地址里取出版本号。
    fn version(&self) -> String {
        self.link
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .trim_start_matches('v')
            .to_string()
    }

    fn into_update_info(self, current_version: &str) -> UpdateInfo {
        let latest_version = self.version();
        UpdateInfo {
            has_update: is_newer(&latest_version, current_version),
            current_version: current_version.to_string(),
            latest_version,
            notes: html_to_text(&self.content),
            published_at: self.updated,
            release_url: if self.link.is_empty() {
                RELEASE_PAGE.to_string()
            } else {
                self.link.clone()
            },
            // Atom 里没有附件直链 —— 让用户从发布页自己挑。
            download_url: String::new(),
            portable_url: String::new(),
        }
    }
}

/// 拉 release 订阅源。
async fn fetch_latest_atom() -> Result<AtomEntry, String> {
    let client = http_client()?;
    let response = client
        .get(RELEASES_ATOM_URL)
        .send()
        .await
        .map_err(|e| format!("连不上 {RELEASES_ATOM_URL}：{e}"))?;

    if !response.status().is_success() {
        return Err(format!("订阅源返回 {}", response.status()));
    }

    let xml = response
        .text()
        .await
        .map_err(|e| format!("读取订阅源失败：{e}"))?;

    parse_atom(&xml).ok_or_else(|| "订阅源里没有 release".to_string())
}

/// 从 Atom feed 里取第一条 entry。
fn parse_atom(xml: &str) -> Option<AtomEntry> {
    let start = xml.find("<entry>")?;
    let end = xml[start..].find("</entry>")? + start;
    let entry = &xml[start..end];

    // <link rel="alternate" type="text/html" href="…/releases/tag/v1.0.0" />
    let link = extract_attr(entry, "link", "href").unwrap_or_default();

    Some(AtomEntry {
        link,
        updated: extract_text(entry, "updated").unwrap_or_default(),
        content: extract_text(entry, "content").unwrap_or_default(),
    })
}

/// 抽 `<标签>内容</标签>`。
fn extract_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start = xml.find(&open)?;
    let after = &xml[start..];
    // 跳过标签自己的属性
    let gt = after.find('>')?;
    let content_start = start + gt + 1;
    let close = format!("</{tag}>");
    // 偏移是相对 after 的，得换算成相对 xml 的绝对位置
    let end = start + gt + after[gt..].find(&close)?;
    Some(xml[content_start..end].to_string())
}

/// 抽某个标签里的某个属性值。
fn extract_attr(xml: &str, tag: &str, attr: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start = xml.find(&open)?;
    let after = &xml[start..];
    let gt = after.find('>')?;
    let tag_body = &after[..gt];
    let key = format!("{attr}=\"");
    let key_at = tag_body.find(&key)? + key.len();
    let end = tag_body[key_at..].find('"')? + key_at;
    Some(tag_body[key_at..end].to_string())
}

/// 常见的 HTML 标签。
///
/// GitHub 把发布说明渲染成 HTML 后再转义，放进 Atom 的 `<content>` 里 ——
/// 也就是说真标签（`&lt;h2&gt;`）和字面量的尖括号（`&lt;智能体名&gt;`、
/// `&lt;c&gt;`）在文本上长得一模一样。
///
/// 解码之后只能靠白名单认：不在名单里的尖括号当成正文留着。
/// 名单要覆盖 GitHub 渲染发布说明时用到的那些 —— 表格、代码块那些。
const KNOWN_TAGS: &[&str] = &[
    "a", "abbr", "article", "aside", "b", "blockquote", "br", "caption", "cite", "code", "col",
    "colgroup", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "input", "ins", "kbd", "label",
    "li", "main", "mark", "nav", "ol", "p", "pre", "q", "s", "samp", "section", "small", "span",
    "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr",
    "u", "ul", "var", "wbr",
];

/// 块级标签 —— 结束时要换行。
///
/// inline 标签（`code`、`strong`、`a`…）结束不能换行，
/// 否则一行文字会被拆成好几段。
const BLOCK_TAGS: &[&str] = &[
    "article", "aside", "blockquote", "dd", "details", "div", "dl", "dt", "figcaption", "figure",
    "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "li", "main", "nav", "ol", "p", "pre",
    "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
];

/// 这个名字是不是已知的 HTML 标签。
fn is_known_tag(name: &str) -> bool {
    KNOWN_TAGS.contains(&name)
}

/// 把 HTML 正文转成能直接显示的纯文本。
///
/// Atom 里的正文是**转义过的** HTML（`&lt;h2&gt;`），所以顺序是：
/// 先解实体，再按标签结构处理。
///
/// 尖括号要分清是标签还是字面量 —— 正文里有
/// `agentspace run <智能体名>` 这种。光看 `<` 开头会把内容吃掉，
/// 所以还得看后面是不是已知标签名。
fn html_to_text(html: &str) -> String {
    // 先解 Atom 的 XML 转义层：
    //   标签 `&lt;h2&gt;` → `<h2>`（真标签，要按结构处理）
    //   实体 `&amp;lt;` → `&lt;`（HTML 实体，等下解）
    //
    // **只能解到这里** —— 属性值里的 `&amp;quot;` 再解一次就变成 `"`，
    // 标签提前结束，后面的结构全乱。
    let decoded = decode_entities(html);
    let chars: Vec<char> = decoded.chars().collect();

    let mut out = String::with_capacity(decoded.len());
    let mut index = 0usize;
    // 在 `<pre>` 里时，换行是内容的一部分，要留着
    let mut pre_depth = 0usize;

    while index < chars.len() {
        match chars[index] {
            '<' => {
                // `<` 后面不是 ASCII 字母也不是 `/` → 字面量的尖括号
                let next = chars.get(index + 1).copied();
                let is_tag = match next {
                    Some('/') => true,
                    Some(ch) => ch.is_ascii_alphabetic(),
                    None => false,
                };
                if !is_tag {
                    out.push('<');
                    index += 1;
                    continue;
                }

                // 找到标签结束
                let end = chars[index..].iter().position(|ch| *ch == '>').map(|p| index + p);
                let Some(end) = end else {
                    out.push('<');
                    index += 1;
                    continue;
                };

                // 标签名（小写）—— 结束标签前面那个 `/` 要跳过
                let name: String = chars[index + 1..end]
                    .iter()
                    .skip_while(|ch| **ch == '/')
                    .take_while(|ch| ch.is_ascii_alphanumeric())
                    .collect::<String>()
                    .to_ascii_lowercase();

                // 不在白名单里的 → 当成正文里的尖括号留着
                if !is_known_tag(&name) {
                    out.push('<');
                    index += 1;
                    continue;
                }

                let closing = chars[index + 1..end].first() == Some(&'/');
                match name.as_str() {
                    "br" => out.push('\n'),
                    "li" => {
                        if closing {
                            out.push('\n');
                        } else {
                            out.push_str("\n- ");
                        }
                    }
                    "tr" => out.push('\n'),
                    // 单元格只在开头加分隔符 —— 结束也加会把表格拆散；
                    // 行首也不该有分隔符。
                    "td" | "th" => {
                        if !closing && !out.ends_with('\n') {
                            out.push_str(" | ");
                        }
                    }
                    _ => {
                        if closing && BLOCK_TAGS.contains(&name.as_str()) {
                            out.push('\n');
                        }
                    }
                }

                if name == "pre" {
                    if closing {
                        pre_depth = pre_depth.saturating_sub(1);
                    } else {
                        pre_depth += 1;
                    }
                }

                index = end + 1;
            }
            '&' => {
                // 文本节点里的 HTML 实体 → 解码
                match decode_entity_at(&chars, index) {
                    Some((text, next)) => {
                        out.push_str(&text);
                        index = next;
                    }
                    None => {
                        out.push('&');
                        index += 1;
                    }
                }
            }
            ch => {
                // GitHub 的 HTML 是格式化的，标签之间有源码换行 ——
                // 那不是内容的换行，跳过。段落分隔靠块级标签产生。
                // `<pre>` 里的换行是代码本身，要留着。
                if (ch != '\n' && ch != '\r') || pre_depth > 0 {
                    out.push(ch);
                }
                index += 1;
            }
        }
    }

    // 收掉多余空行
    let mut cleaned = String::with_capacity(out.len());
    let mut blank = 0;
    for line in out.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        cleaned.push_str(trimmed);
        cleaned.push('\n');
    }

    cleaned.trim().to_string()
}

/// 从 chars[index]（一个 `&`）开始解一个实体。
///
/// 返回 (替换后的文本, 下一个位置)。不是实体就返回 None。
fn decode_entity_at(chars: &[char], index: usize) -> Option<(String, usize)> {
    if chars.get(index) != Some(&'&') {
        return None;
    }

    let mut name = String::new();
    let mut cursor = index + 1;
    while cursor < chars.len() && name.chars().count() <= 12 {
        let ch = chars[cursor];
        if ch == ';' {
            let replacement = match name.as_str() {
                "amp" => "&".to_string(),
                "lt" => "<".to_string(),
                "gt" => ">".to_string(),
                "quot" => "\"".to_string(),
                "apos" => "'".to_string(),
                "nbsp" => " ".to_string(),
                other => decode_numeric_entity(other)?,
            };
            return Some((replacement, cursor + 1));
        }
        name.push(ch);
        cursor += 1;
    }

    None
}

/// 解 HTML 实体。
///
/// 单次扫描 —— 链式 replace 会二次解码（`&amp;lt;` 被解成 `<`）。
fn decode_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp + 1..];

        // 实体最长 12 个字符；`;` 是 ASCII，所以切到它之前一定是字符边界
        let semi = tail.find(';').filter(|pos| *pos <= 12);
        let Some(semi) = semi else {
            // 没有分号 → 是普通的 `&`
            out.push('&');
            rest = tail;
            continue;
        };

        let entity = &tail[..semi];
        let replacement = match entity {
            "amp" => Some("&".to_string()),
            "lt" => Some("<".to_string()),
            "gt" => Some(">".to_string()),
            "quot" => Some("\"".to_string()),
            "apos" => Some("'".to_string()),
            "nbsp" => Some(" ".to_string()),
            other => decode_numeric_entity(other),
        };

        match replacement {
            Some(text) => {
                out.push_str(&text);
                rest = &tail[semi + 1..];
            }
            None => {
                // 不认识的实体 → 原样留着
                out.push('&');
                rest = tail;
            }
        }
    }

    out.push_str(rest);
    out
}

/// 解数字实体：`&#39;` 和 `&#x27;`。
fn decode_numeric_entity(entity: &str) -> Option<String> {
    let digits = entity.strip_prefix('#')?;
    let code = if let Some(hex) = digits.strip_prefix('x').or_else(|| digits.strip_prefix('X')) {
        u32::from_str_radix(hex, 16).ok()?
    } else {
        digits.parse::<u32>().ok()?
    };
    char::from_u32(code).map(|ch| ch.to_string())
}

/// 拉静态版本清单。
///
/// 候选地址依次尝试 —— 第一个拿到就用。
async fn fetch_latest_json() -> Result<LatestJson, String> {
    let client = http_client()?;
    let mut errors = Vec::new();

    for url in latest_json_urls() {
        match fetch_latest_json_from(&client, &url).await {
            Ok(json) => return Ok(json),
            Err(err) => errors.push(err),
        }
    }

    Err(errors.join("；"))
}

/// 从一个地址拉版本清单。
async fn fetch_latest_json_from(client: &reqwest::Client, url: &str) -> Result<LatestJson, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("连不上 {url}：{e}"))?;

    if !response.status().is_success() {
        return Err(format!("{url} 返回 {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取 {url} 失败：{e}"))?;

    // 去掉 UTF-8 BOM —— 某些编辑器/脚本写出来的 JSON 带 BOM，
    // serde_json 不认，会报「expected value at line 1 column 1」。
    let bytes = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        &bytes[..]
    };

    serde_json::from_slice::<LatestJson>(bytes).map_err(|e| format!("解析 {url} 失败：{e}"))
}

/// 拉 GitHub 的 latest release。
async fn fetch_latest_release() -> Result<GithubRelease, String> {
    let client = http_client()?;
    let response = client
        .get(LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("连不上 GitHub：{e}"))?;

    if !response.status().is_success() {
        return Err(format!("GitHub 返回 {}", response.status()));
    }

    response
        .json::<GithubRelease>()
        .await
        .map_err(|e| format!("解析 release 失败：{e}"))
}

/// 建一个带超时的 HTTP 客户端。
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("AgentSpace")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("建 HTTP 客户端失败：{e}"))
}

/// 从附件里挑出 Windows 安装包和便携版。
///
/// 我们只发 NSIS 安装包和便携版 ZIP，名字形如
/// `AgentSpace_1.0.1_x64-setup.exe` 和 `AgentSpace_1.0.1_x64_portable.zip`。
fn pick_windows_assets(assets: &[GithubAsset]) -> (String, String) {
    let mut download_url = String::new();
    let mut portable_url = String::new();

    for asset in assets {
        let name = asset.name.to_ascii_lowercase();
        if name.ends_with(".exe") && download_url.is_empty() {
            download_url = asset.browser_download_url.clone();
        } else if name.ends_with(".zip") && portable_url.is_empty() {
            portable_url = asset.browser_download_url.clone();
        }
    }

    (download_url, portable_url)
}

/// 比较两个版本号：a 比 b 新就返回 true。
///
/// 只认 `数字.数字.数字`，后面的 pre-release 后缀当噪音处理 ——
/// 检测更新关心的是「有没有更高的大版本」。
pub fn is_newer(a: &str, b: &str) -> bool {
    let left = parse_version(a);
    let right = parse_version(b);
    for index in 0..left.len().max(right.len()) {
        // 缺的段当 0 —— 「1」和「1.0.0」是一个版本
        let x = left.get(index).copied().unwrap_or(0);
        let y = right.get(index).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// 把版本号拆成数字段。
fn parse_version(value: &str) -> Vec<u64> {
    value
        .trim()
        .trim_start_matches('v')
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .take(3)
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_numerically() {
        assert!(is_newer("1.0.1", "1.0.0"));
        assert!(is_newer("1.1.0", "1.0.9"));
        assert!(is_newer("2.0.0", "1.9.9"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("1.0.0", "1.0.1"));
    }

    #[test]
    fn ignores_prefix_and_suffix() {
        assert!(is_newer("v1.0.1", "1.0.0"));
        assert!(!is_newer("v1.0.0", "1.0.0"));
        assert!(is_newer("1.0.1-beta.1", "1.0.0"));
    }

    #[test]
    fn treats_missing_parts_as_zero() {
        assert!(is_newer("1.1", "1.0.9"));
        assert!(!is_newer("1", "1.0.0"));
    }

    #[test]
    fn picks_installer_and_portable_from_assets() {
        let assets = vec![
            GithubAsset {
                name: "AgentSpace_1.0.1_x64-setup.exe".to_string(),
                browser_download_url: "https://x/setup.exe".to_string(),
            },
            GithubAsset {
                name: "AgentSpace_1.0.1_x64_portable.zip".to_string(),
                browser_download_url: "https://x/portable.zip".to_string(),
            },
        ];
        let (setup, portable) = pick_windows_assets(&assets);
        assert_eq!(setup, "https://x/setup.exe");
        assert_eq!(portable, "https://x/portable.zip");
    }

    #[test]
    fn ignores_assets_that_are_not_windows_installers() {
        let assets = vec![GithubAsset {
            name: "AgentSpace_1.0.1_x64_en-US.msi".to_string(),
            browser_download_url: "https://x/x.msi".to_string(),
        }];
        let (setup, portable) = pick_windows_assets(&assets);
        assert!(setup.is_empty());
        assert!(portable.is_empty());
    }

    #[test]
    fn latest_json_becomes_update_info() {
        let json = LatestJson {
            version: "v1.2.0".to_string(),
            notes: "修了点东西".to_string(),
            pub_date: "2026-11-13T10:00:00Z".to_string(),
            download_url: "https://x/setup.exe".to_string(),
            portable_url: "https://x/portable.zip".to_string(),
            release_url: "https://x/tag/v1.2.0".to_string(),
        };
        let info = json.into_update_info("1.0.0");

        // 版本号不带 v 前缀
        assert_eq!(info.latest_version, "1.2.0");
        assert!(info.has_update);
        assert_eq!(info.current_version, "1.0.0");
        assert_eq!(info.notes, "修了点东西");
        assert_eq!(info.download_url, "https://x/setup.exe");
        assert_eq!(info.portable_url, "https://x/portable.zip");
        assert_eq!(info.release_url, "https://x/tag/v1.2.0");
    }

    #[test]
    fn latest_json_without_release_url_falls_back_to_release_page() {
        let json = LatestJson {
            version: "1.0.0".to_string(),
            notes: String::new(),
            pub_date: String::new(),
            download_url: String::new(),
            portable_url: String::new(),
            release_url: String::new(),
        };
        let info = json.into_update_info("1.0.0");
        assert_eq!(info.release_url, RELEASE_PAGE);
        // 同版本 → 不是有更新
        assert!(!info.has_update);
    }

    #[test]
    fn parses_manifest_with_bom() {
        // 去掉 BOM 后的解析
        let raw = br#"{"version":"1.2.0","notes":"hi"}"#;
        let with_bom: Vec<u8> = [0xEF, 0xBB, 0xBF].iter().chain(raw.iter()).copied().collect();

        let stripped = if with_bom.starts_with(&[0xEF, 0xBB, 0xBF]) {
            &with_bom[3..]
        } else {
            &with_bom[..]
        };

        let parsed: LatestJson = serde_json::from_slice(stripped).expect("应该能解析");
        assert_eq!(parsed.version, "1.2.0");
        assert_eq!(parsed.notes, "hi");
    }

    #[test]
    fn keeps_normal_manifest_intact() {
        // 不带 BOM 时不能动内容
        let raw = br#"{"version":"1.2.0"}"#;
        let stripped = if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
            &raw[3..]
        } else {
            &raw[..]
        };
        let parsed: LatestJson = serde_json::from_slice(stripped).expect("应该能解析");
        assert_eq!(parsed.version, "1.2.0");
    }

    /// 一段典型的 releases.atom。
    const ATOM: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/1/v1.2.0</id>
    <updated>2026-11-13T08:02:27Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/2000cyj/primeval/releases/tag/v1.2.0"/>
    <title>AgentSpace v1.2.0</title>
    <content type="html">&lt;h1&gt;AgentSpace v1.2.0&lt;/h1&gt;&lt;p&gt;修了点东西&lt;/p&gt;</content>
  </entry>
</feed>"#;

    #[test]
    fn parses_atom_entry() {
        let entry = parse_atom(ATOM).expect("应该能解析出 entry");
        assert_eq!(entry.version(), "1.2.0");
        assert_eq!(
            entry.link,
            "https://github.com/2000cyj/primeval/releases/tag/v1.2.0"
        );
        assert_eq!(entry.updated, "2026-11-13T08:02:27Z");
    }

    #[test]
    fn atom_entry_becomes_update_info() {
        let entry = parse_atom(ATOM).expect("应该能解析出 entry");
        let info = entry.into_update_info("1.0.0");

        assert_eq!(info.latest_version, "1.2.0");
        assert!(info.has_update);
        assert_eq!(info.current_version, "1.0.0");
        assert_eq!(info.published_at, "2026-11-13T08:02:27Z");
        assert_eq!(
            info.release_url,
            "https://github.com/2000cyj/primeval/releases/tag/v1.2.0"
        );
        // Atom 里没有附件直链 —— 用户从发布页自己挑
        assert!(info.download_url.is_empty());
    }

    #[test]
    fn atom_entry_of_same_version_is_not_an_update() {
        let entry = parse_atom(ATOM).expect("应该能解析出 entry");
        let info = entry.into_update_info("1.2.0");
        assert!(!info.has_update);
    }

    #[test]
    fn atom_without_entry_is_none() {
        assert!(parse_atom("<feed></feed>").is_none());
    }

    #[test]
    fn html_to_text_drops_tags_but_keeps_lines() {
        let html = "<h1>标题</h1><p>第一段</p><ul><li>甲</li><li>乙</li></ul>";
        let text = html_to_text(html);

        assert!(!text.contains('<'));
        assert!(!text.contains('>'));
        assert!(text.contains("标题"));
        assert!(text.contains("第一段"));
        // 列表项保留换行和前缀
        assert!(text.contains("\n- 甲"));
        assert!(text.contains("\n- 乙"));
    }

    #[test]
    fn html_to_text_decodes_entities() {
        let text = html_to_text("<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</p>");
        assert!(text.contains("a & b"));
        assert!(text.contains("<c>"));
        assert!(text.contains("\"d\""));
        assert!(text.contains("'e'"));
    }

    #[test]
    fn html_to_text_keeps_table_cells_readable() {
        let text = html_to_text("<table><tr><td>格式</td><td>说明</td></tr></table>");
        assert!(text.contains("格式"));
        assert!(text.contains("说明"));
        assert!(text.contains('|'));
    }

    #[test]
    fn html_to_text_handles_escaped_input() {
        // Atom 里正文是转义过的 —— 得先解实体再当标签处理
        let escaped = "&lt;h2&gt;标题&lt;/h2&gt;&lt;p&gt;正文&lt;/p&gt;";
        let text = html_to_text(escaped);
        assert!(!text.contains('<'));
        assert!(text.contains("标题"));
        assert!(text.contains("正文"));
    }

    #[test]
    fn html_to_text_keeps_literal_angle_brackets() {
        // 正文里的 `agentspace run <智能体名>` 不是标签，不能被吃掉
        let escaped = "agentspace run &lt;智能体名&gt;";
        let text = html_to_text(escaped);
        assert!(text.contains("<智能体名>"));
    }

    #[test]
    fn html_to_text_keeps_unknown_tags_as_text() {
        // `<c>` 不是已知标签 → 当正文留着
        let text = html_to_text("&lt;c&gt;");
        assert!(text.contains("<c>"));
    }

    #[test]
    fn html_to_text_drops_known_tags() {
        let text = html_to_text("&lt;h2&gt;标题&lt;/h2&gt;&lt;p&gt;正文&lt;/p&gt;");
        assert!(!text.contains('<'));
        assert!(text.contains("标题"));
        assert!(text.contains("正文"));
    }

    #[test]
    fn decodes_numeric_entities() {
        assert_eq!(decode_entities("&#39;"), "'");
        assert_eq!(decode_entities("&#x27;"), "'");
        assert_eq!(decode_entities("&#65;"), "A");
    }

    #[test]
    fn does_not_double_decode_within_one_pass() {
        // 单次解码：`&amp;lt;` → `&lt;`（不是 `<`）
        assert_eq!(decode_entities("&amp;lt;"), "&lt;");
    }

    #[test]
    fn html_to_text_decodes_both_layers() {
        // Atom 里字面尖括号是双层转义的：`&amp;lt;` → `&lt;` → `<`
        let text = html_to_text("&amp;lt;智能体名&amp;gt;");
        assert!(text.contains("<智能体名>"));
    }

    #[test]
    fn leaves_unknown_entities_alone() {
        assert_eq!(decode_entities("&unknown;"), "&unknown;");
        assert_eq!(decode_entities("a & b"), "a & b");
    }
}
