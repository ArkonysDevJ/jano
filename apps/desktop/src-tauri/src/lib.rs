#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Fase 1 checklist item 3 -- native clipboard for the credential
    // reveal/copy view's copy-then-verify-before-clear flow (see
    // apps/desktop/src/clipboard/tauri-clipboard-adapter.ts). Registered
    // on the builder itself, not inside .setup(), so it's available to
    // every window from the start rather than only after setup runs.
    .plugin(tauri_plugin_clipboard_manager::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
