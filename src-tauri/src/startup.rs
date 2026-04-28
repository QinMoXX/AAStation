#[cfg(target_os = "windows")]
mod platform {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const STARTUP_VALUE_NAME: &str = "AAStation";

    fn startup_command() -> Result<String, String> {
        let exe_path = std::env::current_exe().map_err(|e| format!("读取当前程序路径失败: {}", e))?;
        Ok(format!("\"{}\"", exe_path.display()))
    }

    pub fn is_enabled() -> Result<bool, String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey_with_flags(RUN_KEY_PATH, KEY_READ)
            .map_err(|e| format!("读取启动项失败: {}", e))?;
        Ok(run_key.get_value::<String, _>(STARTUP_VALUE_NAME).is_ok())
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey_with_flags(RUN_KEY_PATH, KEY_SET_VALUE)
            .map_err(|e| format!("更新启动项失败: {}", e))?;

        if enabled {
            let command = startup_command()?;
            run_key
                .set_value(STARTUP_VALUE_NAME, &command)
                .map_err(|e| format!("写入启动项失败: {}", e))?;
        } else if let Err(e) = run_key.delete_value(STARTUP_VALUE_NAME) {
            // Ignore "value not found" to keep disable idempotent.
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("移除启动项失败: {}", e));
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    pub fn is_enabled() -> Result<bool, String> {
        tracing::info!("macOS 开机自启动功能尚未实现");
        Ok(false)
    }

    pub fn set_enabled(_enabled: bool) -> Result<(), String> {
        tracing::info!("macOS 开机自启动功能尚未实现，忽略设置请求");
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    pub fn is_enabled() -> Result<bool, String> {
        tracing::info!("Linux 开机自启动功能尚未实现");
        Ok(false)
    }

    pub fn set_enabled(_enabled: bool) -> Result<(), String> {
        tracing::info!("Linux 开机自启动功能尚未实现，忽略设置请求");
        Ok(())
    }
}

pub fn is_launch_at_startup_enabled(_app: &tauri::AppHandle) -> Result<bool, String> {
    platform::is_enabled()
}

pub fn set_launch_at_startup_enabled(_app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    platform::set_enabled(enabled)
}
