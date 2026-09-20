//! Supervise native inference without blocking the IPC executor.

use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Debug, PartialEq, Eq)]
pub enum ExecutionError {
    Cancelled,
    Failed(String),
}

pub async fn supervise<T, F>(
    cancellation: CancellationToken,
    timeout: Duration,
    work: F,
) -> Result<T, ExecutionError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    if cancellation.is_cancelled() {
        return Err(ExecutionError::Cancelled);
    }
    let mut worker = tokio::task::spawn_blocking(work);
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            // Abort only prevents a queued worker from starting. A running native
            // call retains its resources and concurrency permit until it returns.
            worker.abort();
            Err(ExecutionError::Cancelled)
        }
        result = &mut worker => match result {
            Ok(value) => value.map_err(ExecutionError::Failed),
            Err(error) => Err(ExecutionError::Failed(format!("RECOGNITION_WORKER_FAILED: {error}"))),
        },
        _ = tokio::time::sleep(timeout) => {
            worker.abort();
            Err(ExecutionError::Failed(format!(
                "RECOGNITION_TIMEOUT: 识别超过 {} 秒，任务已停止等待。请检查模型和运行库；原生推理可能仍在退出中。",
                timeout.as_secs()
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Semaphore;

    #[tokio::test]
    async fn completes_and_propagates_errors() {
        let token = CancellationToken::new();
        assert_eq!(
            supervise(token.clone(), Duration::from_secs(1), || Ok(42)).await,
            Ok(42)
        );
        assert_eq!(
            supervise::<(), _>(token, Duration::from_secs(1), || Err("bad model".into())).await,
            Err(ExecutionError::Failed("bad model".into()))
        );
    }

    #[tokio::test]
    async fn panic_is_a_terminal_error() {
        let result = supervise::<(), _>(CancellationToken::new(), Duration::from_secs(1), || {
            panic!("test worker panic")
        })
        .await;
        assert!(
            matches!(result, Err(ExecutionError::Failed(message)) if message.contains("RECOGNITION_WORKER_FAILED"))
        );
    }

    #[tokio::test]
    async fn cancelled_job_never_starts() {
        let token = CancellationToken::new();
        token.cancel();
        assert_eq!(
            supervise::<(), _>(token, Duration::from_secs(1), || panic!("must not start")).await,
            Err(ExecutionError::Cancelled)
        );
    }

    #[tokio::test]
    async fn timeout_does_not_release_a_running_workers_permit() {
        let slots = Arc::new(Semaphore::new(1));
        let permit = slots.clone().try_acquire_owned().unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let task = tokio::spawn(supervise(
            CancellationToken::new(),
            Duration::from_millis(100),
            move || {
                let _permit = permit;
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(())
            },
        ));
        started_rx.await.unwrap();
        let result = task.await.unwrap();
        assert!(
            matches!(result, Err(ExecutionError::Failed(message)) if message.contains("RECOGNITION_TIMEOUT"))
        );
        assert_eq!(slots.available_permits(), 0);
        release_tx.send(()).unwrap();
        let _released = tokio::time::timeout(Duration::from_secs(1), slots.acquire())
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn cancellation_does_not_wait_for_native_inference() {
        let token = CancellationToken::new();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let task = tokio::spawn(supervise(
            token.clone(),
            Duration::from_secs(5),
            move || {
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(())
            },
        ));
        started_rx.await.unwrap();
        token.cancel();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap(),
            Err(ExecutionError::Cancelled)
        );
        release_tx.send(()).unwrap();
    }
}
