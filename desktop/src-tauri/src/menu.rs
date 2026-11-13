use crate::{
    app, bridge, paths,
    settings::{Language, Settings},
    texts::{self, text},
    updater, whats_new, window, workspace,
};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    AppHandle, Manager, WebviewWindow,
};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_opener::OpenerExt;

fn command_id(label: &str, command: &str) -> String {
    format!("{label}:{command}")
}

fn allowed(label: &str, command: &str) -> bool {
    match label {
        "main" => command != "closeWindow",
        "whats-new" => matches!(
            command,
            "reload"
                | "toggleDevTools"
                | "closeWindow"
                | "undo"
                | "redo"
                | "zoomIn"
                | "zoomOut"
                | "actualSize"
                | "toggleFullScreen"
                | "language:en"
                | "language:ru"
                | "whatsNew"
                | "openLogs"
                | "about"
        ),
        _ => false,
    }
}

fn command_target(id: &str) -> Option<(&str, &str)> {
    let (label, command) = id.split_once(':')?;
    allowed(label, command).then_some((label, command))
}

#[derive(Clone, Debug, PartialEq)]
enum Entry {
    Item {
        id: String,
        text: String,
        enabled: bool,
        accelerator: Option<String>,
    },
    Check {
        id: String,
        text: String,
        enabled: bool,
        checked: bool,
    },
    Predefined {
        kind: Predefined,
        text: Option<String>,
    },
    Submenu {
        id: String,
        text: String,
        items: Vec<Entry>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Predefined {
    Separator,
    Cut,
    Copy,
    Paste,
    SelectAll,
}

struct UpdateModel {
    available: bool,
    busy: bool,
    ready_version: Option<String>,
    portable: bool,
}

struct Snapshot {
    settings: Settings,
    current: Option<String>,
    updates: UpdateModel,
}

struct MenuModel {
    id: String,
    entries: Vec<Entry>,
    generation: u64,
}

impl MenuModel {
    fn sync(
        &mut self,
        generation: u64,
        entries: &[Entry],
        apply: impl FnOnce(&mut Vec<Entry>, &[Entry]) -> tauri::Result<()>,
    ) -> tauri::Result<()> {
        if generation <= self.generation {
            return Ok(());
        }
        // 2026-11-13: even a partial native edit must not be overwritten by an older preparation.
        self.generation = generation;
        apply(&mut self.entries, entries)
    }
}

#[derive(Default)]
pub struct State {
    models: Mutex<HashMap<String, MenuModel>>,
    generation: AtomicU64,
}

impl State {
    fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }
}

fn item(label: &str, lang: &str, key: &str, enabled: bool, accelerator: Option<&str>) -> Entry {
    Entry::Item {
        id: command_id(label, key),
        text: text(lang, key).into(),
        enabled,
        accelerator: accelerator.map(str::to_owned),
    }
}

fn check(label: &str, lang: &str, key: &str, checked: bool) -> Entry {
    Entry::Check {
        id: command_id(label, key),
        text: text(lang, key.strip_prefix("language:").unwrap_or(key)).into(),
        enabled: true,
        checked,
    }
}

fn submenu(label: &str, lang: &str, key: &str, items: Vec<Entry>) -> Entry {
    Entry::Submenu {
        id: command_id(label, key),
        text: text(lang, key).into(),
        items,
    }
}

fn predefined(lang: &str, kind: Predefined) -> Entry {
    let key = match kind {
        Predefined::Separator => None,
        Predefined::Cut => Some("cut"),
        Predefined::Copy => Some("copy"),
        Predefined::Paste => Some("paste"),
        Predefined::SelectAll => Some("selectAll"),
    };
    Entry::Predefined {
        kind,
        text: key.map(|key| text(lang, key).into()),
    }
}

fn snapshot(app: &AppHandle) -> Snapshot {
    let shell = app::state(app);
    let settings = shell.settings.lock().unwrap().clone();
    let current = shell
        .current
        .lock()
        .unwrap()
        .as_ref()
        .filter(|current| current.url.is_some())
        .map(|current| current.folder.clone());
    let updates = UpdateModel {
        available: updater::enabled(),
        busy: shell.updates.busy(),
        ready_version: shell.updates.ready_version(),
        portable: updater::portable().unwrap_or(true),
    };
    Snapshot {
        settings,
        current,
        updates,
    }
}

impl Snapshot {
    fn model(&self, label: &str) -> Vec<Entry> {
        model_for(
            label,
            &self.settings,
            self.current.as_deref(),
            &self.updates,
        )
    }
}

fn prepare_models<T: Send + 'static>(
    targets: Vec<(T, String)>,
    snapshot: impl FnOnce() -> Snapshot + Send + 'static,
) -> tauri::async_runtime::JoinHandle<Vec<(T, Vec<Entry>)>> {
    // 2026-11-13: workspace probes can wait for SMB timeouts; keep the whole preparation off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = snapshot();
        targets
            .into_iter()
            .map(|(target, label)| (target, snapshot.model(&label)))
            .collect()
    })
}

fn model_for(
    label: &str,
    settings: &Settings,
    current: Option<&str>,
    updates: &UpdateModel,
) -> Vec<Entry> {
    let lang = &settings.language;
    let project = current.is_some();
    let can_add = current.is_some_and(|folder| {
        !settings
            .workspace
            .iter()
            .any(|entry| paths::same_path(&entry.path, folder))
    });
    let mut file = Vec::new();
    if allowed(label, "openFolder") {
        let mut recent = Vec::new();
        if settings.recent.is_empty() {
            recent.push(item(label, lang, "noRecent", false, None));
        } else {
            for entry in &settings.recent {
                // 2026-11-09: store the path in the ID so a queued click cannot select a different reordered entry.
                recent.push(Entry::Item {
                    id: command_id(label, &format!("recent:{}", entry.path)),
                    text: format!("{} — {}", entry.name, entry.path).replace('&', "&&"),
                    enabled: true,
                    accelerator: None,
                });
            }
            recent.push(predefined(lang, Predefined::Separator));
            recent.push(item(label, lang, "clearRecent", true, None));
        }
        let mut workspace = Vec::new();
        if settings.workspace.is_empty() {
            workspace.push(item(label, lang, "noWorkspace", false, None));
        }
        for (index, entry) in settings.workspace.iter().enumerate() {
            workspace.push(Entry::Item {
                id: command_id(label, &format!("workspace:{}", entry.path)),
                text: format!("{} — {}", entry.name, entry.path).replace('&', "&&"),
                enabled: std::path::Path::new(&entry.path).is_dir(),
                accelerator: (index < 9).then(|| format!("Ctrl+{}", index + 1)),
            });
        }
        file.extend([
            item(label, lang, "openFolder", true, Some("Ctrl+O")),
            submenu(label, lang, "recentProjects", recent),
            submenu(label, lang, "workspace", workspace),
            item(label, lang, "addCurrentToWorkspace", can_add, None),
            item(label, lang, "revealProject", project, None),
            predefined(lang, Predefined::Separator),
            item(label, lang, "switchProject", true, Some("Ctrl+Shift+P")),
            item(label, lang, "closeProject", project, None),
            predefined(lang, Predefined::Separator),
        ]);
    }
    let (close, shortcut) = if label == "main" {
        ("quit", "Ctrl+Q")
    } else {
        ("closeWindow", "Ctrl+W")
    };
    file.extend([
        item(label, lang, "reload", true, Some("Ctrl+R")),
        item(
            label,
            lang,
            "toggleDevTools",
            cfg!(debug_assertions),
            Some("F12"),
        ),
        predefined(lang, Predefined::Separator),
        item(label, lang, close, true, Some(shortcut)),
    ]);
    let edit = submenu(
        label,
        lang,
        "edit",
        vec![
            item(label, lang, "undo", true, Some("Ctrl+Z")),
            item(label, lang, "redo", true, Some("Ctrl+Y")),
            predefined(lang, Predefined::Separator),
            predefined(lang, Predefined::Cut),
            predefined(lang, Predefined::Copy),
            predefined(lang, Predefined::Paste),
            predefined(lang, Predefined::SelectAll),
        ],
    );
    let language = submenu(
        label,
        lang,
        "interfaceLanguage",
        [Language::English, Language::Russian]
            .into_iter()
            .map(|choice| {
                check(
                    label,
                    lang,
                    &format!("language:{}", choice.as_str()),
                    lang == choice.as_str(),
                )
            })
            .collect(),
    );
    let view = submenu(
        label,
        lang,
        "view",
        vec![
            item(label, lang, "zoomIn", true, Some("Ctrl+=")),
            item(label, lang, "zoomOut", true, Some("Ctrl+-")),
            item(label, lang, "actualSize", true, Some("Ctrl+0")),
            predefined(lang, Predefined::Separator),
            item(label, lang, "toggleFullScreen", true, Some("F11")),
            predefined(lang, Predefined::Separator),
            language,
        ],
    );
    let mut help = Vec::new();
    if allowed(label, "checkUpdates") {
        help.extend([
            item(
                label,
                lang,
                "checkUpdates",
                updates.available && !updates.busy,
                None,
            ),
            check(label, lang, "autoCheckUpdates", settings.updates.auto_check),
        ]);
    }
    help.extend([
        item(label, lang, "whatsNew", true, None),
        predefined(lang, Predefined::Separator),
        item(label, lang, "openLogs", true, None),
        predefined(lang, Predefined::Separator),
        item(label, lang, "about", true, None),
    ]);
    if let Some(version) = updates
        .ready_version
        .as_ref()
        .filter(|_| allowed(label, "installPending"))
    {
        help.insert(
            1,
            Entry::Item {
                id: command_id(label, "installPending"),
                text: texts::format(
                    lang,
                    if updates.portable {
                        "portableUpdatePending"
                    } else {
                        "installPending"
                    },
                    "version",
                    version,
                ),
                enabled: !updates.busy,
                accelerator: None,
            },
        );
    }
    vec![
        submenu(label, lang, "file", file),
        edit,
        view,
        submenu(label, lang, "help", help),
    ]
}

fn build_entry(app: &AppHandle, entry: &Entry) -> tauri::Result<MenuItemKind<tauri::Wry>> {
    match entry {
        Entry::Item {
            id,
            text,
            enabled,
            accelerator,
        } => Ok(MenuItemKind::MenuItem(MenuItem::with_id(
            app,
            id,
            text,
            *enabled,
            accelerator.as_deref(),
        )?)),
        Entry::Check {
            id,
            text,
            enabled,
            checked,
        } => Ok(MenuItemKind::Check(CheckMenuItem::with_id(
            app,
            id,
            text,
            *enabled,
            *checked,
            None::<&str>,
        )?)),
        Entry::Predefined { kind, text } => {
            let item = match kind {
                Predefined::Separator => PredefinedMenuItem::separator(app)?,
                Predefined::Cut => PredefinedMenuItem::cut(app, text.as_deref())?,
                Predefined::Copy => PredefinedMenuItem::copy(app, text.as_deref())?,
                Predefined::Paste => PredefinedMenuItem::paste(app, text.as_deref())?,
                Predefined::SelectAll => PredefinedMenuItem::select_all(app, text.as_deref())?,
            };
            Ok(MenuItemKind::Predefined(item))
        }
        Entry::Submenu { id, text, items } => {
            let submenu = Submenu::with_id(app, id, text, true)?;
            for entry in items {
                submenu.append(&build_entry(app, entry)?)?;
            }
            Ok(MenuItemKind::Submenu(submenu))
        }
    }
}

fn build_model(app: &AppHandle, entries: &[Entry]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    for entry in entries {
        menu.append(&build_entry(app, entry)?)?;
    }
    Ok(menu)
}

pub fn build(app: &AppHandle, label: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let entries = snapshot(app).model(label);
    let menu = build_model(app, &entries)?;
    app::state(app).menus.models.lock().unwrap().insert(
        label.into(),
        MenuModel {
            id: menu.id().as_ref().to_owned(),
            entries,
            generation: 0,
        },
    );
    Ok(menu)
}

fn same_identity(current: &Entry, next: &Entry) -> bool {
    match (current, next) {
        (Entry::Item { id: current, .. }, Entry::Item { id: next, .. })
        | (Entry::Check { id: current, .. }, Entry::Check { id: next, .. })
        | (Entry::Submenu { id: current, .. }, Entry::Submenu { id: next, .. }) => current == next,
        (Entry::Predefined { kind: current, .. }, Entry::Predefined { kind: next, .. }) => {
            current == next
        }
        _ => false,
    }
}

#[derive(Debug, PartialEq)]
enum Change {
    Remove(usize),
    Insert(usize),
    Update(usize),
}

fn plan_changes(current: &[Entry], next: &[Entry]) -> Vec<Change> {
    let mut remaining: Vec<_> = current.iter().collect();
    let mut changes = Vec::new();
    for (index, entry) in next.iter().enumerate() {
        if let Some(offset) = remaining[index..]
            .iter()
            .position(|current| same_identity(current, entry))
        {
            for _ in 0..offset {
                changes.push(Change::Remove(index));
                remaining.remove(index);
            }
            changes.push(Change::Update(index));
        } else {
            changes.push(Change::Insert(index));
            remaining.insert(index, entry);
        }
    }
    for index in (next.len()..remaining.len()).rev() {
        changes.push(Change::Remove(index));
    }
    changes
}

enum Parent<'a> {
    Menu(&'a Menu<tauri::Wry>),
    Submenu(&'a Submenu<tauri::Wry>),
}

impl Parent<'_> {
    fn items(&self) -> tauri::Result<Vec<MenuItemKind<tauri::Wry>>> {
        match self {
            Self::Menu(menu) => menu.items(),
            Self::Submenu(menu) => menu.items(),
        }
    }

    fn insert(&self, entry: &MenuItemKind<tauri::Wry>, index: usize) -> tauri::Result<()> {
        match self {
            Self::Menu(menu) => menu.insert(entry, index),
            Self::Submenu(menu) => menu.insert(entry, index),
        }
    }

    fn remove(&self, index: usize) -> tauri::Result<()> {
        let removed = match self {
            Self::Menu(menu) => menu.remove_at(index)?,
            Self::Submenu(menu) => menu.remove_at(index)?,
        };
        removed.ok_or_else(menu_mismatch)?;
        Ok(())
    }
}

fn menu_mismatch() -> tauri::Error {
    std::io::Error::other("native menu does not match its applied model").into()
}

fn update_entry(
    native: &MenuItemKind<tauri::Wry>,
    current: &mut Entry,
    entry: &Entry,
) -> tauri::Result<()> {
    match (native, entry) {
        (
            MenuItemKind::MenuItem(native),
            Entry::Item {
                id,
                text,
                enabled,
                accelerator,
            },
        ) if native.id().as_ref() == id => {
            native.set_text(text)?;
            native.set_enabled(*enabled)?;
            native.set_accelerator(accelerator.as_deref())?;
        }
        (
            MenuItemKind::Check(native),
            Entry::Check {
                id,
                text,
                enabled,
                checked,
            },
        ) if native.id().as_ref() == id => {
            native.set_text(text)?;
            native.set_enabled(*enabled)?;
            native.set_checked(*checked)?;
        }
        (MenuItemKind::Predefined(native), Entry::Predefined { text, .. }) => {
            if let Some(text) = text {
                native.set_text(text)?;
            }
        }
        (MenuItemKind::Submenu(native), Entry::Submenu { id, text, items })
            if native.id().as_ref() == id =>
        {
            native.set_text(text)?;
            let Entry::Submenu { items: current, .. } = current else {
                return Err(menu_mismatch());
            };
            update_entries(native.app_handle(), Parent::Submenu(native), current, items)?;
        }
        _ => return Err(menu_mismatch()),
    }
    *current = entry.clone();
    Ok(())
}

fn update_entries(
    app: &AppHandle,
    parent: Parent<'_>,
    current: &mut Vec<Entry>,
    entries: &[Entry],
) -> tauri::Result<()> {
    let mut native = parent.items()?;
    if native.len() != current.len() {
        return Err(menu_mismatch());
    }
    for change in plan_changes(current, entries) {
        match change {
            Change::Remove(index) => {
                parent.remove(index)?;
                native.remove(index);
                current.remove(index);
            }
            Change::Insert(index) => {
                let item = build_entry(app, &entries[index])?;
                parent.insert(&item, index)?;
                native.insert(index, item);
                current.insert(index, entries[index].clone());
            }
            Change::Update(index) => {
                update_entry(&native[index], &mut current[index], &entries[index])?;
            }
        }
    }
    Ok(())
}

fn sync_window(
    app: &AppHandle,
    window: &WebviewWindow,
    generation: u64,
    entries: &[Entry],
) -> tauri::Result<()> {
    let Some(menu) = window.menu() else {
        return Ok(());
    };
    let shell = app::state(app);
    // 2026-11-13: release the model lock before native calls; menu callbacks can run on this thread.
    let mut current = shell
        .menus
        .models
        .lock()
        .unwrap()
        .remove(window.label())
        .ok_or_else(menu_mismatch)?;
    let result = if current.id == menu.id().as_ref() {
        current.sync(generation, entries, |current, entries| {
            update_entries(app, Parent::Menu(&menu), current, entries)
        })
    } else {
        Err(menu_mismatch())
    };
    // 2026-11-13: retain successful edits even after an error so the next sync resumes from the real tree.
    shell
        .menus
        .models
        .lock()
        .unwrap()
        .insert(window.label().into(), current);
    result
}

fn sync_windows(
    app: &AppHandle,
    windows: Vec<WebviewWindow>,
) -> impl std::future::Future<Output = Result<(), String>> + Send + 'static {
    // 2026-11-13: allocate before spawning so completion order cannot give an older request a newer generation.
    let generation = app::state(app).menus.next_generation();
    let handle = app.clone();
    let prepared = prepare_models(
        windows
            .into_iter()
            .map(|window| {
                let label = window.label().to_owned();
                (window, label)
            })
            .collect(),
        move || snapshot(&handle),
    );
    let app = app.clone();
    async move {
        let models = prepared.await.map_err(|error| error.to_string())?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let handle = app.clone();
        // 2026-11-13: apply every prepared menu in one UI task; no path probes or snapshots run here.
        app.run_on_main_thread(move || {
            let mut errors = Vec::new();
            for (window, entries) in models {
                if let Err(error) = sync_window(&handle, &window, generation, &entries) {
                    errors.push(format!("menu failed ({}): {error}", window.label()));
                }
            }
            let _ = sender.send(errors);
        })
        .map_err(|error| error.to_string())?;
        let errors = receiver.await.map_err(|error| error.to_string())?;
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }
}

pub fn sync(app: &AppHandle) {
    let synced = sync_windows(app, app.webview_windows().into_values().collect());
    let shell = app::state(app);
    tauri::async_runtime::spawn(async move {
        if let Err(error) = synced.await {
            shell.log.write(format!("menu sync failed: {error}"));
        }
    });
}

pub async fn sync_before_show(window: &WebviewWindow) -> Result<(), String> {
    sync_windows(window.app_handle(), vec![window.clone()]).await
}

fn message(window: &WebviewWindow, key: &str, detail: &str, kind: MessageDialogKind) {
    let app = window.app_handle();
    let lang = app::state(app).language();
    let app = app.clone();
    let window = window.clone();
    let title = text(&lang, key).to_owned();
    let detail = detail.to_owned();
    tauri::async_runtime::spawn(async move {
        dialog_for(
            &app,
            Some(&window),
            &title,
            &detail,
            MessageDialogButtons::OkCustom(text(&lang, "ok").into()),
            kind,
        )
        .await;
    });
}

pub async fn dialog(
    app: &AppHandle,
    title: &str,
    detail: &str,
    buttons: MessageDialogButtons,
    kind: MessageDialogKind,
) -> MessageDialogResult {
    dialog_for(
        app,
        app.get_webview_window("main").as_ref(),
        title,
        detail,
        buttons,
        kind,
    )
    .await
}

async fn dialog_for(
    app: &AppHandle,
    parent: Option<&WebviewWindow>,
    title: &str,
    detail: &str,
    buttons: MessageDialogButtons,
    kind: MessageDialogKind,
) -> MessageDialogResult {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .message(if detail.is_empty() { title } else { detail })
        .title(title)
        .kind(kind)
        .buttons(buttons);
    if let Some(window) = parent {
        dialog = dialog.parent(window);
    }
    dialog.show_with_result(move |result| {
        let _ = sender.send(result);
    });
    receiver.await.unwrap_or_default()
}

fn accepted(result: MessageDialogResult, label: &str) -> bool {
    matches!(result, MessageDialogResult::Custom(value) if value == label)
}

#[cfg(debug_assertions)]
fn debug_answer(question: &str, yes: &str, no: &str) -> Option<bool> {
    // 2026-11-09: smoke can answer one named question without enabling answers to unrelated dialogs.
    let policy = std::env::var("DECKMATE_DESKTOP_ASK_POLICY").ok()?;
    let (key, answer) = policy.split_once('=')?;
    if key != question {
        return None;
    }
    if answer == yes {
        Some(true)
    } else if answer == no {
        Some(false)
    } else {
        None
    }
}

#[cfg(not(debug_assertions))]
fn debug_answer(_: &str, _: &str, _: &str) -> Option<bool> {
    None
}

pub async fn ask(app: &AppHandle, question: &str, yes: &str, no: &str) -> bool {
    let shell = app::state(app);
    shell.log.write(format!("native question: {question}"));
    if let Some(answer) = debug_answer(question, yes, no) {
        shell
            .log
            .write(format!("native question debug answer: {question}={answer}"));
        return answer;
    }
    let language = shell.language();
    let yes = text(&language, yes);
    let result = dialog(
        app,
        "Deckmate",
        text(&language, question),
        MessageDialogButtons::OkCancelCustom(yes.into(), text(&language, no).into()),
        MessageDialogKind::Warning,
    )
    .await;
    accepted(result, yes)
}

async fn open(window: &WebviewWindow, folder: String) {
    let app = window.app_handle();
    if let Err(error) = app::open_project(app, folder).await {
        if matches!(error.code.as_str(), "missing" | "invalid-path") {
            message(
                window,
                "openFailed",
                &error.message,
                MessageDialogKind::Warning,
            );
        }
    }
}

pub fn handle(app: &AppHandle, event: MenuEvent) {
    // 2026-11-13: Tauri broadcasts menu events without an HWND, even to window listeners; IDs retain the source.
    let Some((label, command)) = command_target(event.id().as_ref()) else {
        return;
    };
    if let Some(window) = app.get_webview_window(label) {
        dispatch(&window, command);
    }
}

pub fn dispatch(window: &WebviewWindow, id: &str) {
    if !allowed(window.label(), id) {
        return;
    }
    let app = window.app_handle();
    let shell = app::state(app);
    match id {
        "quit" => app::request_quit(app),
        "closeWindow" => {
            let _ = window.close();
        }
        "autoCheckUpdates" => updater::toggle_auto_check(app),
        "zoomIn" => window::change_zoom(window, 0.1),
        "zoomOut" => window::change_zoom(window, -0.1),
        "actualSize" => window::set_zoom(window, 1.0),
        "addCurrentToWorkspace" => {
            let result = workspace::add_current(app);
            if result["ok"] == false {
                message(
                    window,
                    "workspace",
                    result["message"].as_str().unwrap_or(""),
                    MessageDialogKind::Warning,
                );
            }
        }
        "reload" => {
            let _ = window.reload();
        }
        "toggleDevTools" => {
            #[cfg(debug_assertions)]
            {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        "toggleFullScreen" => {
            let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
        }
        "undo" | "redo" => {
            let _ = window.eval(format!("document.execCommand('{id}')"));
        }
        "revealProject" => {
            if let Some(current) = shell.current.lock().unwrap().as_ref() {
                let _ = app.opener().reveal_item_in_dir(&current.folder);
            }
        }
        "openLogs" => {
            let _ = app
                .opener()
                .open_path(shell.directory.to_string_lossy(), None::<&str>);
        }
        "about" => message(
            window,
            "about",
            &format!(
                "Deckmate {}\nDesktop {}\nTauri 2.12.5\nNode {}",
                shell.deckmate_version,
                env!("CARGO_PKG_VERSION"),
                env!("DECKMATE_BUNDLED_NODE_VERSION")
            ),
            MessageDialogKind::Info,
        ),
        "clearRecent" => {
            let project = shell
                .current
                .lock()
                .unwrap()
                .as_ref()
                .map(|current| current.folder.clone());
            let saved = shell.update_settings(|settings| {
                settings.recent.clear();
                settings.last_project = project;
                Ok(())
            });
            sync(app);
            if let Err(error) = saved {
                message(
                    window,
                    "saveFailedTitle",
                    &error.message,
                    MessageDialogKind::Error,
                );
            }
            if window.url().is_ok_and(|url| window::is_launcher_url(&url)) {
                let _ = window.reload();
            }
        }
        _ => {
            let app = app.clone();
            let window = window.clone();
            let id = id.to_owned();
            tauri::async_runtime::spawn(async move {
                match id.as_str() {
                    "language:en" | "language:ru" => {
                        let language = if id == "language:ru" {
                            Language::Russian
                        } else {
                            Language::English
                        };
                        if let Err(error) = bridge::set_language(&app, language).await {
                            sync(&app);
                            message(
                                &window,
                                "saveFailedTitle",
                                &error.message,
                                MessageDialogKind::Error,
                            );
                        }
                    }
                    "checkUpdates" => updater::check(&app, true).await,
                    "installPending" => updater::install_ready(&app).await,
                    "whatsNew" => whats_new::open(&app, None).await,
                    "openFolder" => {
                        if let Some(folder) = bridge::choose_folder(&app).await {
                            open(&window, folder).await;
                        }
                    }
                    "switchProject" | "closeProject" => {
                        let _ = app::show_launcher(&app, None).await;
                    }
                    _ => {
                        let folder = {
                            let settings = shell.settings.lock().unwrap();
                            if let Some(folder) = id.strip_prefix("workspace:") {
                                settings
                                    .workspace
                                    .iter()
                                    .find(|entry| paths::same_path(&entry.path, folder))
                                    .map(|entry| entry.path.clone())
                            } else {
                                id.strip_prefix("recent:").and_then(|folder| {
                                    settings
                                        .recent
                                        .iter()
                                        .find(|entry| paths::same_path(&entry.path, folder))
                                        .map(|entry| entry.path.clone())
                                })
                            }
                        };
                        if let Some(folder) = folder {
                            open(&window, folder).await;
                        }
                    }
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command_ids(entries: &[Entry]) -> Vec<String> {
        let mut ids = Vec::new();
        for entry in entries {
            match entry {
                Entry::Item { id, .. } | Entry::Check { id, .. } => ids.push(id.clone()),
                Entry::Submenu { items, .. } => ids.extend(command_ids(items)),
                Entry::Predefined { .. } => {}
            }
        }
        ids
    }

    fn updates() -> UpdateModel {
        UpdateModel {
            available: true,
            busy: false,
            ready_version: None,
            portable: true,
        }
    }

    fn children<'a>(entries: &'a [Entry], key: &str) -> &'a [Entry] {
        entries
            .iter()
            .find_map(|entry| match entry {
                Entry::Submenu { id, items, .. } if id == &command_id("main", key) => {
                    Some(items.as_slice())
                }
                _ => None,
            })
            .unwrap()
    }

    fn projects(settings: &Settings, key: &str) -> Vec<Entry> {
        children(
            children(&model_for("main", settings, None, &updates()), "file"),
            key,
        )
        .to_vec()
    }

    fn assert_updates_only(current: &[Entry], next: &[Entry]) {
        assert_eq!(
            plan_changes(current, next),
            (0..next.len()).map(Change::Update).collect::<Vec<_>>()
        );
        for (current, next) in current.iter().zip(next) {
            if let (Entry::Submenu { items: current, .. }, Entry::Submenu { items: next, .. }) =
                (current, next)
            {
                assert_updates_only(current, next);
            }
        }
    }

    #[test]
    fn preparation_keeps_blocking_work_off_the_calling_thread() {
        use std::{sync::mpsc, thread, time::Duration};

        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let snapshot = Snapshot {
            settings: Settings::normalize(
                serde_json::json!({
                    "workspace": [
                        {"path": root, "name": "Directory"},
                        {"path": root.join("Cargo.toml"), "name": "File"}
                    ]
                }),
                "en",
            ),
            current: None,
            updates: updates(),
        };
        let caller = thread::current().id();
        let (started, observed) = mpsc::channel();
        let (release, blocked) = mpsc::channel();
        let timeout = Duration::from_secs(10);
        let prepared = prepare_models(
            vec![("main", "main".into()), ("whats-new", "whats-new".into())],
            move || {
                assert_ne!(thread::current().id(), caller);
                started.send(()).unwrap();
                blocked.recv_timeout(timeout).unwrap();
                snapshot
            },
        );
        observed.recv_timeout(timeout).unwrap();
        release.send(()).unwrap();
        let models = tauri::async_runtime::block_on(prepared).unwrap();
        assert_eq!(models.len(), 2);
        let workspace = children(children(&models[0].1, "file"), "workspace");
        assert!(matches!(workspace[0], Entry::Item { enabled: true, .. }));
        assert!(matches!(workspace[1], Entry::Item { enabled: false, .. }));
        assert!(!command_ids(&models[1].1)
            .iter()
            .any(|id| id.contains(":workspace:")));
    }

    #[test]
    fn older_preparation_cannot_overwrite_a_newer_menu_even_after_a_partial_error() {
        for fail in [false, true] {
            let state = State::default();
            let mut settings = Settings::normalize(serde_json::Value::Null, "en");
            let initial = model_for("main", &settings, None, &updates());
            let mut menu = MenuModel {
                id: "main-menu".into(),
                entries: initial.clone(),
                generation: 0,
            };
            let older = state.next_generation();
            settings.language = "ru".into();
            let newer = state.next_generation();
            let next = model_for("main", &settings, None, &updates());
            let result = menu.sync(newer, &next, |current, entries| {
                if fail {
                    current[0] = entries[0].clone();
                    Err(menu_mismatch())
                } else {
                    *current = entries.to_vec();
                    Ok(())
                }
            });
            assert_eq!(result.is_err(), fail);
            let applied = menu.entries.clone();
            menu.sync(older, &initial, |_, _| {
                panic!("an older preparation must not touch native menu entries")
            })
            .unwrap();
            assert_eq!(menu.entries, applied);
            assert_ne!(menu.entries, initial);
        }
    }

    #[test]
    fn registered_window_refreshes_the_language_missed_during_construction() {
        let state = State::default();
        let mut settings = Settings::normalize(serde_json::Value::Null, "en");
        let initial = model_for("whats-new", &settings, None, &updates());
        let mut main = MenuModel {
            id: "main-menu".into(),
            entries: model_for("main", &settings, None, &updates()),
            generation: 0,
        };

        settings.language = "ru".into();
        let language_sync = state.next_generation();
        let main_entries = model_for("main", &settings, None, &updates());
        let expected = model_for("whats-new", &settings, None, &updates());
        // 2026-11-13: the language sync enumerated only main before the new window registered its initial menu.
        let mut registered = MenuModel {
            id: "whats-new-menu".into(),
            entries: initial.clone(),
            generation: 0,
        };
        let registration_sync = state.next_generation();
        let prepared = prepare_models(vec![((), "whats-new".into())], move || Snapshot {
            settings,
            current: None,
            updates: updates(),
        });
        let models = tauri::async_runtime::block_on(prepared).unwrap();
        registered
            .sync(registration_sync, &models[0].1, |current, entries| {
                assert_updates_only(current, entries);
                *current = entries.to_vec();
                Ok(())
            })
            .unwrap();
        assert_eq!(registered.id, "whats-new-menu");
        assert_eq!(registered.entries, expected);
        assert_ne!(registered.entries, initial);

        // 2026-11-13: refreshing one new window must not discard a pending sync for the other windows.
        main.sync(language_sync, &main_entries, |current, entries| {
            *current = entries.to_vec();
            Ok(())
        })
        .unwrap();
        assert_eq!(main.entries, main_entries);
    }

    #[test]
    fn language_project_and_update_state_only_update_existing_entries() {
        for label in ["main", "whats-new"] {
            let english = Settings::normalize(
                serde_json::json!({"language": "en", "updates": {"autoCheck": false}}),
                "en",
            );
            let russian = Settings::normalize(
                serde_json::json!({"language": "ru", "updates": {"autoCheck": true}}),
                "en",
            );
            let current = model_for(label, &english, Some("C:\\project"), &updates());
            let ids = command_ids(&current);
            let next = model_for(
                label,
                &russian,
                None,
                &UpdateModel {
                    busy: true,
                    ..updates()
                },
            );
            assert_updates_only(&current, &next);
            assert_updates_only(&next, &current);
            assert_eq!(command_ids(&next), ids);
            assert_ne!(current, next);
            let Entry::Submenu { text, .. } = &next[0] else {
                panic!("File must remain the first submenu");
            };
            assert_eq!(text, "Файл");
            let Entry::Submenu { items: edit, .. } = &next[1] else {
                panic!("Edit submenu")
            };
            assert_eq!(edit[3], predefined("ru", Predefined::Cut));
            let Entry::Submenu { items: view, .. } = &next[2] else {
                panic!("View submenu")
            };
            let Entry::Submenu {
                items: language, ..
            } = view.last().unwrap()
            else {
                panic!("Language submenu")
            };
            assert_eq!(
                language,
                &vec![
                    check(label, "ru", "language:en", false),
                    check(label, "ru", "language:ru", true)
                ]
            );
            if label == "main" {
                let file = children(&next, "file");
                assert_eq!(file[7], item(label, "ru", "closeProject", false, None));
                let help = children(&next, "help");
                assert_eq!(help[0], item(label, "ru", "checkUpdates", false, None));
                assert_eq!(help[1], check(label, "ru", "autoCheckUpdates", true));
            }
        }
    }

    #[test]
    fn pending_update_is_inserted_and_removed_inside_help() {
        use Change::*;
        let settings = Settings::normalize(serde_json::Value::Null, "en");
        let current = model_for("main", &settings, None, &updates());
        let next = model_for(
            "main",
            &settings,
            None,
            &UpdateModel {
                ready_version: Some("0.9.0".into()),
                ..updates()
            },
        );
        assert_eq!(
            plan_changes(&current, &next),
            vec![Update(0), Update(1), Update(2), Update(3)]
        );
        let before = children(&current, "help");
        let after = children(&next, "help");
        assert_eq!(
            plan_changes(before, after),
            vec![
                Update(0),
                Insert(1),
                Update(2),
                Update(3),
                Update(4),
                Update(5),
                Update(6),
                Update(7)
            ]
        );
        assert_eq!(
            plan_changes(after, before),
            vec![
                Update(0),
                Remove(1),
                Update(1),
                Update(2),
                Update(3),
                Update(4),
                Update(5),
                Update(6)
            ]
        );
        assert!(
            matches!(&after[1], Entry::Item { id, text, .. } if id == "main:installPending" && text.contains("0.9.0"))
        );
    }

    #[test]
    fn first_recent_and_clear_list_replace_the_placeholder_inside_recent() {
        use Change::*;
        let mut settings = Settings::normalize(serde_json::Value::Null, "en");
        let empty = projects(&settings, "recentProjects");
        settings.remember("C:/A");
        let first = projects(&settings, "recentProjects");
        assert_eq!(
            plan_changes(&empty, &first),
            vec![Insert(0), Insert(1), Insert(2), Remove(3)]
        );
        assert_eq!(
            command_ids(&first),
            ["main:recent:C:/A", "main:clearRecent"]
        );
        settings.recent.clear();
        assert_eq!(
            plan_changes(&first, &projects(&settings, "recentProjects")),
            vec![Insert(0), Remove(3), Remove(2), Remove(1)]
        );
        settings.remember("C:/A");
        settings.remove_recent("C:/A");
        assert_eq!(projects(&settings, "recentProjects"), empty);
    }

    #[test]
    fn opening_second_recent_keeps_path_ids_and_reorders_only_its_popup() {
        use Change::*;
        let mut settings = Settings::normalize(serde_json::Value::Null, "en");
        settings.remember("C:/B");
        settings.remember("C:/A");
        let before = projects(&settings, "recentProjects");
        let queued = command_ids(&before)[0].clone();
        settings.remember("C:/B");
        let after = projects(&settings, "recentProjects");
        assert_eq!(
            plan_changes(&before, &after),
            vec![Remove(0), Update(0), Insert(1), Update(2), Update(3)]
        );
        assert_eq!(
            command_ids(&after),
            ["main:recent:C:/B", "main:recent:C:/A", "main:clearRecent"]
        );
        assert_eq!(command_target(&queued), Some(("main", "recent:C:/A")));
        assert_eq!(queued, command_ids(&after)[1]);
    }

    #[test]
    fn new_and_removed_recents_plan_insertions_and_removals() {
        use Change::*;
        let mut settings = Settings::normalize(serde_json::Value::Null, "en");
        settings.remember("C:/A");
        let before = projects(&settings, "recentProjects");
        settings.remember("C:/B");
        let after = projects(&settings, "recentProjects");
        assert_eq!(
            plan_changes(&before, &after),
            vec![Insert(0), Update(1), Update(2), Update(3)]
        );
        settings.remove_recent("C:/A");
        assert_eq!(
            plan_changes(&after, &projects(&settings, "recentProjects")),
            vec![Update(0), Remove(1), Update(1), Update(2)]
        );
        settings.recent.clear();
        assert_eq!(
            plan_changes(&after, &projects(&settings, "recentProjects")),
            vec![Insert(0), Remove(4), Remove(3), Remove(2), Remove(1)]
        );
    }

    #[test]
    fn a_full_recent_list_inserts_the_new_path_and_removes_the_evicted_path() {
        use Change::*;
        let mut settings = Settings::normalize(serde_json::Value::Null, "en");
        for index in 0..10 {
            settings.remember(&format!("C:/project-{index}"));
        }
        let before = projects(&settings, "recentProjects");
        settings.remember("C:/new");
        let after = projects(&settings, "recentProjects");
        let mut expected = vec![Insert(0)];
        expected.extend((1..10).map(Update));
        expected.extend([Remove(10), Update(10), Update(11)]);
        assert_eq!(plan_changes(&before, &after), expected);
        assert_eq!(command_ids(&after)[0], "main:recent:C:/new");
        assert!(!command_ids(&after).contains(&"main:recent:C:/project-0".into()));
    }

    #[test]
    fn workspace_add_move_and_remove_update_shortcuts_and_placeholders() {
        use Change::*;
        let mut settings = Settings::normalize(serde_json::Value::Null, "en");
        let empty = projects(&settings, "workspace");
        settings.add_to_workspace("C:/A").unwrap();
        let first = projects(&settings, "workspace");
        assert_eq!(plan_changes(&empty, &first), vec![Insert(0), Remove(1)]);
        settings.add_to_workspace("C:/B").unwrap();
        let second = projects(&settings, "workspace");
        assert_eq!(plan_changes(&first, &second), vec![Update(0), Insert(1)]);
        settings.move_in_workspace("C:/B", 0).unwrap();
        let moved = projects(&settings, "workspace");
        assert_eq!(
            plan_changes(&second, &moved),
            vec![Remove(0), Update(0), Insert(1)]
        );
        for (index, entry) in moved.iter().enumerate() {
            assert!(
                matches!(entry, Entry::Item { accelerator: Some(shortcut), .. } if shortcut == &format!("Ctrl+{}", index + 1))
            );
        }
        settings.remove_from_workspace("C:/B").unwrap();
        assert_eq!(
            plan_changes(&moved, &projects(&settings, "workspace")),
            vec![Remove(0), Update(0)]
        );
        settings.remove_from_workspace("C:/A").unwrap();
        assert_eq!(
            plan_changes(&first, &projects(&settings, "workspace")),
            vec![Insert(0), Remove(1)]
        );
    }

    #[test]
    fn planner_never_relabels_a_different_command_or_predefined_kind() {
        use Change::*;
        let current = vec![item("main", "en", "reload", true, None)];
        for next in [
            item("main", "ru", "quit", true, None),
            check("main", "en", "reload", true),
            submenu("main", "en", "reload", vec![]),
        ] {
            assert_eq!(plan_changes(&current, &[next]), vec![Insert(0), Remove(1)]);
        }
        assert_eq!(
            plan_changes(
                &[predefined("en", Predefined::Copy)],
                &[predefined("ru", Predefined::Cut)]
            ),
            vec![Insert(0), Remove(1)]
        );
    }

    #[test]
    fn menu_commands_keep_their_source_window_and_full_project_path() {
        for label in ["main", "whats-new"] {
            for command in [
                "zoomIn",
                "zoomOut",
                "actualSize",
                "reload",
                "undo",
                "toggleFullScreen",
                "language:en",
                "language:ru",
                "about",
            ] {
                let id = command_id(label, command);
                assert_eq!(command_target(&id), Some((label, command)));
            }
        }
        for command in ["recent:C:\\project:notes", "workspace:C:\\Проект"] {
            let id = command_id("main", command);
            assert_eq!(command_target(&id), Some(("main", command)));
        }
    }

    #[test]
    fn secondary_menus_cannot_dispatch_project_or_main_window_commands() {
        for command in [
            "openFolder",
            "closeProject",
            "switchProject",
            "clearRecent",
            "addCurrentToWorkspace",
            "revealProject",
            "recent:C:\\demo",
            "workspace:C:\\demo",
            "quit",
            "checkUpdates",
            "autoCheckUpdates",
            "installPending",
        ] {
            assert!(command_target(&command_id("main", command)).is_some());
            assert_eq!(command_target(&command_id("whats-new", command)), None);
        }
        assert_eq!(
            command_target("whats-new:closeWindow"),
            Some(("whats-new", "closeWindow"))
        );
        for id in ["reload", "zoomIn", "unknown:reload", "main:closeWindow"] {
            assert_eq!(command_target(id), None);
        }
    }

    #[test]
    fn only_explicit_leave_accepts_the_unsaved_dialog() {
        for language in ["en", "ru"] {
            let leave = text(language, "leave");
            assert!(accepted(MessageDialogResult::Custom(leave.into()), leave));
            for result in [
                MessageDialogResult::Cancel,
                MessageDialogResult::No,
                MessageDialogResult::Custom(text(language, "stay").into()),
            ] {
                assert!(!accepted(result, leave));
            }
        }
    }
}
