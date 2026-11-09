fn main() {
    println!("cargo:rerun-if-changed=../node-runtime.json");
    // 2026-11-09: embed the pinned runtime without starting Node just to show About.
    let runtime: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string("../node-runtime.json").expect("read Node runtime pin"),
    )
    .expect("parse Node runtime pin");
    let version = runtime["version"]
        .as_str()
        .filter(|value| !value.is_empty() && value.chars().all(|c| c.is_ascii_digit() || c == '.'))
        .expect("Node runtime version");
    println!("cargo:rustc-env=DECKMATE_BUNDLED_NODE_VERSION={version}");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_get_state",
            "desktop_choose_folder",
            "desktop_open_project",
            "desktop_create_project",
            "desktop_remove_recent",
            "desktop_set_language",
            "board_recent_projects",
            "board_switch_project",
            "board_show_start_screen",
            "whats_new_get",
        ]),
    ))
    .expect("build Tauri shell");
}
