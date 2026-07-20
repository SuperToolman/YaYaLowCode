#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let web_url = std::env::var("YAYA_WEB_URL")
        .ok()
        .or_else(|| option_env!("YAYA_WEB_URL").map(str::to_owned))
        .unwrap_or_else(|| "http://127.0.0.1:3000".to_string());
    let web_url = web_url
        .parse()
        .unwrap_or_else(|error| panic!("invalid YAYA_WEB_URL `{web_url}`: {error}"));

    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(web_url))
                .title("丫丫低代码平台")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 720.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Yaya desktop application");
}
