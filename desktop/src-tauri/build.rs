fn main() {
    // 2026-11-13: generate_context! embeds these pages during Rust compilation, including direct cargo builds.
    assert!(
        std::path::Path::new("../dist/index.html").is_file()
            && std::path::Path::new("../dist/startup.html").is_file()
            && std::path::Path::new("../dist/whats-new.html").is_file(),
        "Desktop frontend is missing from desktop/dist. Run `npm run build:desktop` from the repository root before building the Rust shell."
    );
    println!("cargo:rerun-if-changed=../dist");
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
            "desktop_set_theme",
            "desktop_add_to_workspace",
            "desktop_remove_from_workspace",
            "desktop_move_in_workspace",
            "board_recent_projects",
            "board_workspace_projects",
            "board_add_to_workspace",
            "board_remove_from_workspace",
            "board_move_in_workspace",
            "board_switch_project",
            "board_show_start_screen",
            "board_set_dirty",
            "board_set_theme",
            "board_set_language",
            "whats_new_get",
        ]),
    ))
    .expect("build Tauri shell");
}
