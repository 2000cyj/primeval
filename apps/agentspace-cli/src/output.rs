//! 输出格式。
//!
//! 默认给人看（对齐的表格 / 逐行文本），加 `--json` 给 agent 拿去解析。
//!
//! CLI 首要用户是脚本和 agent，所以**机器可读格式
//! 必须是第一等的**，不能是「加个补丁才有」。

use serde::Serialize;

/// 全局输出格式。
#[derive(Clone, Copy, Debug, clap::ValueEnum)]
pub enum Format {
    /// 人看的表格 / 逐行文本
    Text,
    /// JSON
    Json,
}

impl Format {
    /// 是否是 JSON。
    pub fn is_json(self) -> bool {
        matches!(self, Format::Json)
    }
}

/// 是不是要 JSON 输出。
///
/// `--format json` 和 `--json` 两种写法都认 —— 后者对脚本和 agent 更顺手。
pub fn wants_json(format: Format, json: bool) -> bool {
    json || format.is_json()
}

/// 打印一份 JSON（`--json` 时用）。
pub fn json<T: Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(raw) => println!("{raw}"),
        Err(error) => eprintln!("序列化失败：{error}"),
    }
}

/// 打印一张表。
///
/// `rows` 是每行的若干列；列宽按内容算，超宽就换行 —— 免得中文列宽算错。
pub fn table(headers: &[&str], rows: &[Vec<String>]) {
    if rows.is_empty() {
        return;
    }
    let columns = headers.len();
    let mut widths: Vec<usize> = headers.iter().map(|h| display_width(h)).collect();
    for row in rows {
        for (index, cell) in row.iter().enumerate().take(columns) {
            widths[index] = widths[index].max(display_width(cell));
        }
    }
    let mut out = String::new();
    push_row(&mut out, headers, &widths);
    for row in rows {
        push_row(&mut out, row, &widths);
    }
    print!("{out}");
}

/// 打印一行行文本（每行一条记录）。
pub fn lines(items: &[String]) {
    for item in items {
        println!("{item}");
    }
}

/// 输出一段多行文本（保留原样）。
pub fn text(value: &str) {
    print!("{value}");
    if !value.ends_with('\n') {
        println!();
    }
}

fn push_row(out: &mut String, cells: &[impl AsRef<str>], widths: &[usize]) {
    let last = cells.len().saturating_sub(1);
    for (index, cell) in cells.iter().enumerate() {
        let value = cell.as_ref();
        if index == last {
            out.push_str(value);
        } else {
            let pad = widths[index].saturating_sub(display_width(value));
            out.push_str(value);
            out.push_str(&" ".repeat(pad + 2));
        }
    }
    out.push('\n');
}

/// 显示宽度：中文按两格算。
fn display_width(value: &str) -> usize {
    value.chars().map(char_width).sum()
}

fn char_width(ch: char) -> usize {
    let code = ch as u32;
    // CJK 统一表意文字、全角标点等
    let wide = (0x1100..=0x115F).contains(&code)
        || (0x2E80..=0xA4CF).contains(&code)
        || (0xAC00..=0xD7A3).contains(&code)
        || (0xF900..=0xFAFF).contains(&code)
        || (0xFE30..=0xFE6F).contains(&code)
        || (0xFF00..=0xFF60).contains(&code)
        || (0xFFE0..=0xFFE6).contains(&code)
        || (0x20000..=0x3FFFD).contains(&code);
    if wide { 2 } else { 1 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chinese_counts_as_two_columns() {
        assert_eq!(display_width("abc"), 3);
        assert_eq!(display_width("中文"), 4);
        assert_eq!(display_width("a中b"), 4);
    }

    #[test]
    fn table_aligns_columns() {
        let mut out = String::new();
        push_row(&mut out, &["名称", "版本"], &[8, 6]);
        push_row(&mut out, &["a", "1.0"], &[8, 6]);
        // 第一列补齐到 8 + 2 空格
        assert!(out.lines().nth(0).unwrap().starts_with("名称      "));
    }
}
