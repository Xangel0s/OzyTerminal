param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("control-plane", "agent", "client")]
  [string]$Role,

  [string]$ControlPlaneUrl = "http://127.0.0.1:8080",
  [string]$ControlPlaneListen = "127.0.0.1:8080",
  [string]$RelayListen = "127.0.0.1:9443",
  [string]$RelayPublicAddress = "127.0.0.1:9443",
  [string]$NodeId = "demo-node-1",
  [string]$UpstreamHost = "127.0.0.1",
  [string]$AccessToken = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

switch ($Role) {
  "control-plane" {
    $env:OZY_CONTROL_PLANE_LISTEN = $ControlPlaneListen
    $env:OZY_RELAY_LISTEN = $RelayListen
    $env:OZY_RELAY_PUBLIC_ADDRESS = $RelayPublicAddress
    if ($AccessToken) {
      $env:OZY_CONTROL_PLANE_ACCESS_TOKEN = $AccessToken
    }
    Push-Location $repoRoot
    try {
      cargo run -p ozyterminal-control-plane
    }
    finally {
      Pop-Location
    }
  }
  "agent" {
    $env:OZY_CONTROL_PLANE_URL = $ControlPlaneUrl
    $env:OZY_AGENT_NODE_ID = $NodeId
    $env:OZY_AGENT_UPSTREAM_HOST = $UpstreamHost
    if ($AccessToken) {
      $env:OZY_CONTROL_PLANE_ACCESS_TOKEN = $AccessToken
    }
    Push-Location $repoRoot
    try {
      cargo run -p ozyterminal-agent-node
    }
    finally {
      Pop-Location
    }
  }
  "client" {
    Push-Location (Join-Path $repoRoot "app-client")
    try {
      npm run tauri dev
    }
    finally {
      Pop-Location
    }
  }
}
