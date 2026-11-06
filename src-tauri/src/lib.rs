use std::io::Read;

/// Download the new installer and launch it, then quit so it can replace this app.
#[tauri::command]
fn install_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Refusing to download an update over an insecure connection".into());
    }
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("Download failed: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(500 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Download failed: {e}"))?;
    if bytes.len() < 1024 {
        return Err("The downloaded installer looks incomplete".into());
    }
    let path = std::env::temp_dir().join("Torrekin-update-setup.exe");
    std::fs::write(&path, &bytes).map_err(|e| format!("Could not save installer: {e}"))?;
    std::process::Command::new(&path)
        .spawn()
        .map_err(|e| format!("Could not start installer: {e}"))?;
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![install_update])
        .run(tauri::generate_context!())
        .expect("error while running Torrekin");
}
