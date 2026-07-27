# Polls origin for new commits; if found, pulls, reinstalls deps, and restarts
# the bot under pm2. Run on a schedule (see README's Auto-deploy section) —
# not meant to be run continuously in a loop itself.

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# Matches config.js's DEPLOY_BRANCH — deploys explicitly from this branch
# regardless of whatever the server's working copy currently has checked out,
# rather than trusting `git pull`'s implicit "current branch's upstream".
$Branch = if ($env:DEPLOY_BRANCH) { $env:DEPLOY_BRANCH } else { 'main' }

# $ErrorActionPreference only governs PowerShell's own errors, not exit codes from
# external commands (git/npm/pm2) — without this check a failed `git pull` would
# silently fall through to `pm2 restart`, restarting the OLD code and logging
# "Deploy complete." as if nothing were wrong.
function Assert-Success([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$step failed with exit code $LASTEXITCODE"
    }
}

# The webhook fires this script detached, once per push delivery, with no
# queueing — back-to-back pushes (or a retried delivery) can otherwise overlap
# two instances on the same working tree mid git-checkout/pull. A stale lock
# (crashed run) older than one deploy's worth of time is ignored and reclaimed
# rather than deadlocking every future deploy.
$LockFile = Join-Path $PSScriptRoot 'deploy.lock'
if (Test-Path $LockFile) {
    $age = (Get-Date) - (Get-Item $LockFile).LastWriteTime
    if ($age.TotalMinutes -lt 10) {
        Write-Output "$(Get-Date -Format u) Deploy already in progress, skipping this run."
        exit 0
    }
    Write-Output "$(Get-Date -Format u) Stale lock file (age $([int]$age.TotalMinutes)m), reclaiming."
}
New-Item -ItemType File -Path $LockFile -Force | Out-Null

try {
    git fetch origin
    Assert-Success 'git fetch'
    git checkout $Branch
    Assert-Success "git checkout $Branch"

    $local = git rev-parse HEAD
    $remote = git rev-parse "origin/$Branch"

    if ($local -ne $remote) {
        Write-Output "$(Get-Date -Format u) New commits found ($local -> $remote), deploying..."
        git pull origin $Branch
        Assert-Success 'git pull'
        npm install
        Assert-Success 'npm install'
        npm run build:admin
        Assert-Success 'build:admin'
        pm2 restart discord-bot
        Assert-Success 'pm2 restart'
        Write-Output "$(Get-Date -Format u) Deploy complete."
    } else {
        Write-Output "$(Get-Date -Format u) Up to date."
    }
} finally {
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}
