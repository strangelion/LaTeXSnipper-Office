use std::ffi::OsStr;
use std::io;
use std::process::{Command, Output};
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Create a background command that hides the console window on Windows.
/// Use this for all external processes (reg.exe, powershell.exe, etc.)
pub fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Run a command with a timeout. If the process does not exit within the
/// given duration, it is killed and `io::ErrorKind::TimedOut` is returned.
/// This prevents reg.exe/certutil.exe from hanging the Office toggle forever.
pub fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> io::Result<Output> {
    use std::sync::mpsc;
    use std::thread;

    let (tx, rx) = mpsc::channel();

    // Spawn the process in a thread so we can set a timeout
    let mut child = cmd.spawn()?;
    let child_stdin = child.stdin.take();
    let child_id = child.id();

    thread::spawn(move || {
        // Drop stdin handle so the child doesn't wait for input
        drop(child_stdin);
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            // Kill the child process
            let _ = kill_process(child_id);
            Err(io::Error::new(io::ErrorKind::TimedOut, "process timed out"))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err(io::Error::new(io::ErrorKind::BrokenPipe, "process channel disconnected"))
        }
    }
}

/// Kill a process by PID. Best-effort on Windows via taskkill.
fn kill_process(pid: u32) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let _ = background_command("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
        Ok(())
    }
}
