use std::{collections::HashMap, sync::{Arc, Mutex}};

use futures::{SinkExt, StreamExt};
use tauri::{State, ipc::Channel};
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        Message,
        client::IntoClientRequest,
        http::{HeaderName, HeaderValue},
        protocol::{CloseFrame, frame::coding::CloseCode},
    },
};

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct SocketHead {
    pub name: String,
    pub value: String,
}

#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SocketEvt {
    Open,
    Text { data: String },
    Binary { data: Vec<u8> },
    Error { message: String },
    Close {
        code: Option<u16>,
        reason: Option<String>,
        clean: bool,
    },
}

enum SocketMsg {
    Text(String),
    Close(Option<u16>, Option<String>),
}

#[derive(Clone, Default)]
pub struct SocketState {
    conn: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<SocketMsg>>>>,
}

fn send(events: &Channel<SocketEvt>, evt: SocketEvt) {
    let _ = events.send(evt);
}

fn fail(events: &Channel<SocketEvt>, err: String) {
    send(
        events,
        SocketEvt::Error {
            message: err.clone(),
        },
    );
    send(
        events,
        SocketEvt::Close {
            code: Some(1006),
            reason: Some(err),
            clean: false,
        },
    );
}

fn drop(state: &Arc<Mutex<HashMap<String, mpsc::UnboundedSender<SocketMsg>>>>, id: &str) {
    state.lock().expect("Failed to acquire socket mutex").remove(id);
}

fn req(url: String, headers: Vec<SocketHead>) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, String> {
    let mut req = url
        .into_client_request()
        .map_err(|e| format!("Failed to build websocket request: {e}"))?;

    for head in headers {
        let name = HeaderName::from_bytes(head.name.as_bytes())
            .map_err(|e| format!("Invalid websocket header name: {e}"))?;
        let value = HeaderValue::from_str(&head.value)
            .map_err(|e| format!("Invalid websocket header value: {e}"))?;
        req.headers_mut().insert(name, value);
    }

    Ok(req)
}

#[tauri::command]
#[specta::specta]
pub fn open_socket(
    state: State<'_, SocketState>,
    url: String,
    headers: Vec<SocketHead>,
    events: Channel<SocketEvt>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let conn = state.inner().conn.clone();
    conn.lock()
        .expect("Failed to acquire socket mutex")
        .insert(id.clone(), tx);

    tauri::async_runtime::spawn({
        let id = id.clone();
        async move {
            let req = match req(url, headers) {
                Ok(req) => req,
                Err(err) => {
                    fail(&events, err);
                    drop(&conn, &id);
                    return;
                }
            };

            let (sock, _) = match connect_async(req).await {
                Ok(sock) => sock,
                Err(err) => {
                    fail(&events, format!("Failed to connect websocket: {err}"));
                    drop(&conn, &id);
                    return;
                }
            };

            send(&events, SocketEvt::Open);
            let (mut out, mut input) = sock.split();

            loop {
                tokio::select! {
                    next = input.next() => {
                        match next {
                            Some(Ok(Message::Text(data))) => send(&events, SocketEvt::Text { data: data.to_string() }),
                            Some(Ok(Message::Binary(data))) => send(&events, SocketEvt::Binary { data: data.to_vec() }),
                            Some(Ok(Message::Close(frame))) => {
                                send(&events, SocketEvt::Close {
                                    code: frame.as_ref().map(|frame| u16::from(frame.code)),
                                    reason: frame.as_ref().map(|frame| frame.reason.to_string()),
                                    clean: true,
                                });
                                break;
                            }
                            Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) | Some(Ok(Message::Frame(_))) => {}
                            Some(Err(err)) => {
                                fail(&events, format!("Websocket receive failed: {err}"));
                                break;
                            }
                            None => {
                                send(&events, SocketEvt::Close {
                                    code: Some(1000),
                                    reason: None,
                                    clean: true,
                                });
                                break;
                            }
                        }
                    }
                    next = rx.recv() => {
                        match next {
                            Some(SocketMsg::Text(data)) => {
                                if let Err(err) = out.send(Message::Text(data.into())).await {
                                    fail(&events, format!("Websocket send failed: {err}"));
                                    break;
                                }
                            }
                            Some(SocketMsg::Close(code, reason)) => {
                                let frame = if code.is_none() && reason.is_none() {
                                    None
                                } else {
                                    Some(CloseFrame {
                                        code: CloseCode::from(code.unwrap_or(1000)),
                                        reason: reason.clone().unwrap_or_default().into(),
                                    })
                                };

                                if let Err(err) = out.send(Message::Close(frame)).await {
                                    fail(&events, format!("Websocket close failed: {err}"));
                                    break;
                                }

                                send(&events, SocketEvt::Close {
                                    code,
                                    reason,
                                    clean: true,
                                });
                                break;
                            }
                            None => break,
                        }
                    }
                }
            }

            drop(&conn, &id);
        }
    });

    Ok(id)
}

#[tauri::command]
#[specta::specta]
pub fn write_socket(state: State<'_, SocketState>, id: String, data: String) -> Result<(), String> {
    let conn = state.inner().conn.lock().expect("Failed to acquire socket mutex");
    let Some(conn) = conn.get(&id) else {
        return Err("Socket not found".to_string());
    };

    conn.send(SocketMsg::Text(data))
        .map_err(|_| "Failed to write websocket".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn close_socket(
    state: State<'_, SocketState>,
    id: String,
    code: Option<u16>,
    reason: Option<String>,
) -> Result<(), String> {
    let conn = state.inner().conn.lock().expect("Failed to acquire socket mutex");
    let Some(conn) = conn.get(&id) else {
        return Ok(());
    };

    conn.send(SocketMsg::Close(code, reason))
        .map_err(|_| "Failed to close websocket".to_string())
}
