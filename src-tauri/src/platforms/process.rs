#[cfg(target_os = "windows")]
use std::ffi::OsStr;
use std::io;
use std::process::{Command, Output};
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Create a background command that hides the console window on Windows.
/// Use this for all external processes (reg.exe, powershell.exe, etc.)
#[cfg(target_os = "windows")]
pub fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

/// Run a command with a timeout. If the process does not exit within the
/// given duration, it is killed and `io::ErrorKind::TimedOut` is returned.
/// This prevents reg.exe/certutil.exe from hanging the Office toggle forever.
pub fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> io::Result<Output> {
    use std::process::Stdio;
    use std::thread;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();

    // IMPORTANT:
    // Command::spawn() does not capture stdout/stderr by default. Several Office
    // integration checks parse `reg.exe query` output, so leaving stdout inherited
    // makes those checks see an empty Output even when reg.exe succeeded. That was
    // causing false failures such as:
    //   post-write verification failed: LoadBehavior not readable after write
    // after successful `reg add` calls.
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Spawn the process in a thread so we can set a timeout.
    let child = cmd.spawn()?;
    let child_id = child.id();

    thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    // The public API is synchronous because registry and installer callers are
    // synchronous. Run the Tokio timer on a dedicated thread so this function
    // remains safe when called from inside an existing Tauri runtime.
    let timer = thread::spawn(move || -> io::Result<Output> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .map_err(|error| {
                io::Error::other(format!("failed to create timeout runtime: {error}"))
            })?;

        runtime.block_on(async move {
            match tokio::time::timeout(timeout, rx).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "process channel disconnected",
                )),
                Err(_) => Err(io::Error::new(io::ErrorKind::TimedOut, "process timed out")),
            }
        })
    });

    match timer.join() {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(error)) if error.kind() == io::ErrorKind::TimedOut => {
            // Kill the child process.
            let _ = kill_process(child_id);
            Err(io::Error::new(io::ErrorKind::TimedOut, "process timed out"))
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "process timeout worker panicked",
        )),
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
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        Ok(())
    }
}
