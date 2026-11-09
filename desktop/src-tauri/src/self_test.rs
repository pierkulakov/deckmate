use crate::{
    log::Log,
    paths::{self, Programs},
    server,
};
use serde_json::json;
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    time::timeout,
};

async fn get(url: &str) -> Result<(), String> {
    let address = url.strip_prefix("http://").ok_or("Invalid server URL")?;
    let mut stream = TcpStream::connect(address)
        .await
        .map_err(|e| e.to_string())?;
    stream
        .write_all(
            format!("GET / HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n").as_bytes(),
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut status = String::new();
    BufReader::new(stream)
        .read_line(&mut status)
        .await
        .map_err(|e| e.to_string())?;
    if status.split_whitespace().nth(1) == Some("200") {
        Ok(())
    } else {
        Err(format!("HTTP GET: {}", status.trim()))
    }
}

pub async fn run(folder: &str) -> i32 {
    let started = Instant::now();
    let mut url = None;
    let mut error = None;
    let mut start_ms = 0;
    let mut stop_ms = 0;
    let result = (|| {
        if !Path::new(folder).is_dir() {
            return Err(std::io::Error::other(format!("Folder not found: {folder}")));
        }
        let directory = paths::settings_dir()?;
        server::start(
            &Programs::resolve(None)?,
            &directory,
            folder,
            Log::open(&directory),
            "en".into(),
        )
    })();
    let mut ok = false;
    match result {
        Ok((server, ready)) => {
            let ready = ready.await;
            start_ms = started.elapsed().as_millis();
            match ready {
                Ok(Ok(ready_url)) => {
                    let response = timeout(Duration::from_secs(20), get(&ready_url)).await;
                    url = Some(ready_url);
                    match response {
                        Ok(Ok(())) => ok = true,
                        Ok(Err(message)) => error = Some(message),
                        Err(_) => error = Some("HTTP GET timed out".into()),
                    }
                }
                Ok(Err(failure)) => error = Some(failure.message),
                Err(failure) => error = Some(failure.to_string()),
            }
            let stopping = Instant::now();
            let exit = server.stop().await;
            stop_ms = stopping.elapsed().as_millis();
            if exit.forced {
                error.get_or_insert_with(|| {
                    "Server required kill fallback after stdin shutdown".into()
                });
            } else if exit.code != Some(0) {
                ok = false;
                error.get_or_insert_with(|| {
                    format!("Server exited with code {}", server::exit_code(exit.code))
                });
            }
        }
        Err(failure) => error = Some(failure.to_string()),
    }
    println!(
        "{}",
        json!({"ok":ok,"url":url,"startMs":start_ms,"stopMs":stop_ms,"error":error})
    );
    if ok {
        0
    } else {
        1
    }
}
