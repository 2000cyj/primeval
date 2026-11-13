//! 扩展市场 —— 从 npm registry 搜 pi 的扩展包。
//!
//! # 为什么走 npm 而不是 pi.dev
//!
//! pi 官方的市场在 <https://pi.dev/packages>，但**没有开放 API**
//! （`/api/packages` 返回 501 "API routes are reserved for future features"）。
//!
//! 市场的数据源其实就是 npm —— pi 的包文档说，npm 包带上
//! `keywords: ["pi-package"]` 关键字就会出现在市场目录里。
//! 所以直接查 npm registry 的 search 接口：更快、更全、也不依赖网页结构。
//!
//! ```text
//! GET https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=20
//! ```

use serde::Serialize;

/// 市场里的一个包。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplacePackage {
    /// npm 包名（装的时候用 `npm:<name>`）。
    pub name: String,
    /// 描述。
    pub description: String,
    /// 最新版本。
    pub version: String,
    /// 作者（npm 上没有就空）。
    pub author: Option<String>,
    /// 仓库地址。
    pub repository: Option<String>,
    /// 主页。
    pub homepage: Option<String>,
    /// 下载量（周）。
    pub weekly_downloads: u64,
    /// 发布时间。
    pub published_at: Option<String>,
    /// 关键字。
    pub keywords: Vec<String>,
}

/// npm registry 的 search 响应（只要用到的字段）。
#[derive(Debug, serde::Deserialize)]
struct SearchResponse {
    #[serde(default)]
    total: u64,
    #[serde(default)]
    objects: Vec<SearchObject>,
}

#[derive(Debug, serde::Deserialize)]
struct SearchObject {
    #[serde(default)]
    downloads: Downloads,
    #[serde(default)]
    package: PackageMeta,
}

#[derive(Debug, Default, serde::Deserialize)]
struct Downloads {
    #[serde(default)]
    weekly: u64,
}

#[derive(Debug, Default, serde::Deserialize)]
struct PackageMeta {
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    author: Option<AuthorMeta>,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    links: Links,
    #[serde(default)]
    date: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
enum AuthorMeta {
    Text(String),
    Object { name: Option<String> },
}

impl AuthorMeta {
    fn name(&self) -> Option<String> {
        match self {
            AuthorMeta::Text(text) => Some(text.clone()),
            AuthorMeta::Object { name } => name.clone(),
        }
    }
}

#[derive(Debug, Default, serde::Deserialize)]
struct Links {
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
}

/// 搜索结果。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// 命中的总数（整个市场，不是这一页）。
    pub total: u64,
    /// 这一页的结果。
    pub packages: Vec<MarketplacePackage>,
    /// 这一页从第几条开始（0 = 第一页）。
    pub offset: usize,
    /// 这一页取了多少条。
    pub limit: usize,
}

/// 搜扩展市场。
///
/// `query` 为空 = 只按 `pi-package` 关键字搜（13600+ 个）。
/// 有关键词时再加上（用 npm 的 search 语法，两者是与关系）。
///
/// `offset` 是跳过多少条 —— npm 的 search 接口用 `from` 做偏移，
/// 用来翻页（一次最多 250 条）。
pub async fn search(query: &str, limit: usize, offset: usize) -> Result<SearchResult, String> {
    let limit = limit.clamp(1, 250);
    let offset = offset.min(10_000);
    let text = if query.trim().is_empty() {
        "keywords:pi-package".to_string()
    } else {
        format!("keywords:pi-package {}", query.trim())
    };
    let url = format!(
        "https://registry.npmjs.org/-/v1/search?text={}&size={limit}&from={offset}",
        encode(&text)
    );

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("AgentSpace/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let response = response
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求 npm registry 失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("npm registry 返回 {}", response.status()));
    }
    let payload: SearchResponse = response.json().await.map_err(|e| e.to_string())?;

    let packages = payload
        .objects
        .into_iter()
        .map(|item| MarketplacePackage {
            name: item.package.name,
            description: item.package.description.unwrap_or_default(),
            version: item.package.version,
            author: item.package.author.and_then(|author| author.name()),
            repository: item.package.links.repository,
            homepage: item.package.links.homepage,
            weekly_downloads: item.downloads.weekly,
            published_at: item.package.date,
            keywords: item.package.keywords,
        })
        .filter(|item| !item.name.is_empty())
        .collect();

    Ok(SearchResult {
        total: payload.total,
        packages,
        offset,
        limit,
    })
}

/// percent-encoding（只处理必要字符）。
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            // 冒号是 search 语法的一部分（keywords:xxx），不能编码
            b':' => out.push(':'),
            b' ' => out.push_str("%20"),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_query() {
        assert_eq!(encode("keywords:pi-package foo"), "keywords:pi-package%20foo");
        assert_eq!(encode("a:b"), "a:b");
        assert_eq!(encode("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn parses_search_response() {
        let raw = r#"{
          "total": 13635,
          "objects": [{
            "downloads": { "weekly": 1200 },
            "package": {
              "name": "pi-thing",
              "version": "1.2.3",
              "description": "an extension",
              "keywords": ["pi-package"],
              "links": {
                "repository": "git+https://github.com/o/r.git",
                "homepage": "https://example.com"
              },
              "date": "2026-01-01T00:00:00.000Z"
            }
          }]
        }"#;
        let parsed: SearchResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.total, 13635);
        assert_eq!(parsed.objects.len(), 1);
        let item = &parsed.objects[0];
        assert_eq!(item.package.name, "pi-thing");
        assert_eq!(item.downloads.weekly, 1200);
        assert_eq!(
            item.package.links.repository.as_deref(),
            Some("git+https://github.com/o/r.git")
        );
    }

    #[test]
    fn author_can_be_string_or_object() {
        let a: AuthorMeta = serde_json::from_str("\"someone\"").unwrap();
        assert_eq!(a.name().as_deref(), Some("someone"));
        let b: AuthorMeta = serde_json::from_str("{\"name\":\"team\"}").unwrap();
        assert_eq!(b.name().as_deref(), Some("team"));
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// 实测：搜 npm 上的 pi 扩展包
    #[test]
    #[ignore = "需要网络"]
    fn live_search() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(search("", 5, 0)).unwrap();
        println!("共 {} 个", result.total);
        for item in result.packages.iter() {
            println!("  {} v{} | {} 下载", item.name, item.version, item.weekly_downloads);
        }
        assert!(!result.packages.is_empty());
        assert!(result.total > 1000);
    }
}
