use std::process::Command;
use url::Url;

pub fn open(
    base: &str,
    conversation_id: Option<String>,
    contact_id: Option<String>,
    notifications: bool,
) -> Result<(), String> {
    let base = Url::parse(base).map_err(|error| error.to_string())?;
    if !matches!(base.scheme(), "http" | "https") || base.host_str().is_none() {
        return Err("invalid platform URL".into());
    }
    let target = message_url(
        &base,
        conversation_id.as_deref(),
        contact_id.as_deref(),
        notifications,
    );
    launch(Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", target.as_str()]))
}

fn message_url(
    base: &Url,
    conversation_id: Option<&str>,
    contact_id: Option<&str>,
    notifications: bool,
) -> Url {
    let mut target = base.clone();
    if notifications {
        // 复用平台已有的通知中心深链，让旧版网页也能打开消息中心。
        target
            .query_pairs_mut()
            .append_pair("notify", "system_announcement");
    } else if conversation_id.is_some_and(|id| !id.is_empty())
        || contact_id.is_some_and(|id| !id.is_empty())
    {
        let mut query = target.query_pairs_mut();
        if let Some(id) = conversation_id.filter(|id| !id.is_empty()) {
            query.append_pair("pet-chat", id);
        }
        if let Some(id) = contact_id.filter(|id| !id.is_empty()) {
            query.append_pair("pet-contact", id);
        }
    }
    target
}

fn launch(command: &mut Command) -> Result<(), String> {
    let status = command.status().map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("platform launch failed ({status})"))
    }
}
