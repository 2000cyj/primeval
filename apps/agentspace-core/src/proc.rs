//! 跑外部命令 —— Windows 上不弹窗。
//!
//! # 为什么需要这个模块
//!
//! Windows 上 Rust 执行 `.cmd` / `.bat` 会自动改走 `cmd.exe /c` ——
//! **不隐藏窗口的话，每个命令都会闪一个黑框**。
//!
//! 探测本机装了哪些 CLI 时最明显：14 个 CLI 挨个跑一次 `--version`，
//! 就是 14 个 cmd 窗口依次闪一下（每个只活几百毫秒，看着像"有东西在乱弹"）。
//!
//! `CREATE_NO_WINDOW` 让这些子进程不创建窗口 —— 命令照跑，窗口不出现。
//!
//! # 用法
//!
//! ```ignore
//! use agentspace_core::proc::command;
//!
//! let output = command(path)
//!     .arg("--version")
//!     .output()?;
//! ```

use std::ffi::OsStr;
use std::process::Command;


/// Windows 的 `CREATE_NO_WINDOW`。
///
/// 让子进程在**无窗口**下运行 —— cmd.exe 本身不弹窗。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 建一条命令。
///
/// Windows 上带 `CREATE_NO_WINDOW`；其它平台就是原样的 `Command::new`。
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// 建一条命令并挂上参数。
pub fn command_with_args(program: impl AsRef<OsStr>, args: &[&str]) -> Command {
    let mut cmd = command(program);
    cmd.args(args);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[cfg(windows)]
    use std::path::{Path, PathBuf};

    /// 写一个 .cmd 脚本，返回它的路径。
    #[cfg(windows)]
    fn write_batch(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"@echo off\r\necho batch-ok\r\n").unwrap();
        path
    }

    /// Windows 上跑 .cmd 必须成功。
    ///
    /// Rust 对 .cmd / .bat 会自动改走 `cmd.exe /c`（相对路径不行，
    /// 绝对路径才行）—— 这正是「弹 cmd 窗口」的来源。
    /// 这个测试守住「用 proc::command 跑 .cmd 仍然能跑通」，
    /// 免得以后有人以为加 flag 会改变执行语义。
    #[cfg(windows)]
    #[test]
    fn runs_batch_file_with_no_window_flag() {
        let dir = std::env::temp_dir().join(format!("agentspace-proc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let batch = write_batch(&dir, "probe.cmd");

        let output = command(&batch).output().expect("应该能跑 .cmd");
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            stdout.contains("batch-ok"),
            "stdout 应该是批处理的输出，实际：{stdout:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 非 Windows 上就是普通的 Command::new。
    #[cfg(not(windows))]
    #[test]
    fn runs_regular_program() {
        let output = command("echo").arg("hello").output().expect("应该能跑");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("hello"));
    }
}
