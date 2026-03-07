use std::sync::{Mutex, MutexGuard, OnceLock};

fn global_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub fn lock_test_env() -> MutexGuard<'static, ()> {
    global_env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
