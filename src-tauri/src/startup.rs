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
    use super::LAUNCH_AT_STARTUP_UNSUPPORTED_MESSAGE;

    pub fn is_enabled() -> Result<bool, String> {
        Err(LAUNCH_AT_STARTUP_UNSUPPORTED_MESSAGE.to_string())
    }

    pub fn set_enabled(_enabled: bool) -> Result<(), String> {
        Err(LAUNCH_AT_STARTUP_UNSUPPORTED_MESSAGE.to_string())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::path::PathBuf;

    fn config_home() -> Result<PathBuf, String> {
        match std::env::var("XDG_CONFIG_HOME") {
            Ok(value) if !value.trim().is_empty() => Ok(PathBuf::from(value)),
            _ => {
                let home = std::env::var("HOME")
                    .map_err(|_| "读取 HOME 失败，无法确定 Linux 配置目录".to_string())?;
                Ok(PathBuf::from(home).join(".config"))
            }
        }
    }

    fn desktop_file_path() -> Result<PathBuf, String> {
        Ok(config_home()?.join("autostart").join("AAStation.desktop"))
    }

    fn startup_exec() -> Result<String, String> {
        let exe_path = std::env::current_exe().map_err(|e| format!("读取当前程序路径失败: {}", e))?;
        let exe = exe_path.to_string_lossy().to_string();
        Ok(if exe.contains(' ') { format!("\"{}\"", exe) } else { exe })
    }

    fn desktop_entry_content() -> Result<String, String> {
        let exec = startup_exec()?;
        Ok(format!(
            "[Desktop Entry]\nType=Application\nVersion=1.0\nName=AAStation\nComment=AAStation - API 代理\nExec={}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
            exec
        ))
    }

    pub fn is_enabled() -> Result<bool, String> {
        Ok(desktop_file_path()?.exists())
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        let desktop_path = desktop_file_path()?;
        if enabled {
            if let Some(parent) = desktop_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建 autostart 目录失败: {}", e))?;
            }
            let content = desktop_entry_content()?;
            std::fs::write(&desktop_path, content)
                .map_err(|e| format!("写入 autostart 文件失败: {}", e))?;
            return Ok(());
        }

        if let Err(e) = std::fs::remove_file(&desktop_path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("移除 autostart 文件失败: {}", e));
            }
        }
        Ok(())
    }
}

pub const LAUNCH_AT_STARTUP_UNSUPPORTED_MESSAGE: &str = "当前平台不支持开机自启动";

pub fn is_launch_at_startup_enabled(_app: &tauri::AppHandle) -> Result<bool, String> {
    platform::is_enabled()
}

pub fn set_launch_at_startup_enabled(_app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    platform::set_enabled(enabled)
}
