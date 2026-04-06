// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{
    include_image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent,
};
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to("main", "tray-open", ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "emoji_rule_label",
            sql: include_str!("../migrations/002_emoji_rule_label.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "days_table",
            sql: include_str!("../migrations/003_days.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "app_settings_table",
            sql: include_str!("../migrations/004_app_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "day_note_column",
            sql: include_str!("../migrations/005_day_note.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "work_log_pinned",
            sql: include_str!("../migrations/006_work_log_pinned.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::new().build());
    }

    let builder = builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:daily-work-log.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            #[cfg(desktop)]
            {
                let icon = app
                    .default_window_icon()
                    .cloned()
                    .unwrap_or_else(|| include_image!("icons/32x32.png").into());
                let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
                let _ = TrayIconBuilder::with_id("main-tray")
                    .tooltip("Daily Work Log")
                    .icon(icon)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "show" => {
                            show_main_window(&app);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        let app = tray.app_handle();
                        match &event {
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } => show_main_window(&app),
                            #[cfg(target_os = "windows")]
                            TrayIconEvent::DoubleClick {
                                button: MouseButton::Left,
                                ..
                            } => show_main_window(&app),
                            _ => {}
                        }
                    })
                    .build(app);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(desktop)]
                {
                    window.hide().ok();
                    api.prevent_close();
                }
            }
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(move |app_handle, event| {
        // macOS Dock icon click (applicationShouldHandleReopen).
        // Always show/focus main: hidden windows can still leave `has_visible_windows` true in edge cases.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = &event {
            show_main_window(app_handle);
        }

        #[cfg(desktop)]
        if let RunEvent::ExitRequested { api, code, .. } = &event {
            // Keep app running when window is closed so tray icon persists
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
