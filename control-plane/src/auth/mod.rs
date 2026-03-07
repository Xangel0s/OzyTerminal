use axum::http::HeaderMap;

#[derive(Clone)]
pub struct AccessTokenValidator {
    required_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuthenticatedActor {
    pub subject: String,
    pub auth_mode: String,
}

impl AccessTokenValidator {
    pub fn from_env() -> Self {
        Self {
            required_token: std::env::var("OZY_CONTROL_PLANE_ACCESS_TOKEN").ok(),
        }
    }

    pub fn authenticate(&self, headers: &HeaderMap) -> Result<AuthenticatedActor, String> {
        let bearer = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|value| !value.is_empty());

        match (&self.required_token, bearer) {
            (Some(expected), Some(provided)) if provided == expected => Ok(AuthenticatedActor {
                subject: "configured-bearer-token".into(),
                auth_mode: "bearer".into(),
            }),
            (Some(_), _) => Err("missing or invalid bearer token".into()),
            (None, Some(_)) => Ok(AuthenticatedActor {
                subject: "developer-bearer".into(),
                auth_mode: "dev-bearer".into(),
            }),
            (None, None) => Ok(AuthenticatedActor {
                subject: "anonymous-dev".into(),
                auth_mode: "dev-bypass".into(),
            }),
        }
    }
}
