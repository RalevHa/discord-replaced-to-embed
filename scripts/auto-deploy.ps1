# Polls origin for new commits; if found, pulls, reinstalls deps, and restarts
# the bot under pm2. Run on a schedule (see README's Auto-deploy section) —
# not meant to be run continuously in a loop itself.

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# Matches config.js's DEPLOY_BRANCH — deploys explicitly from this branch
# regardless of whatever the server's working copy currently has checked out,
# rather than trusting `git pull`'s implicit "current branch's upstream".
$Branch = if ($env:DEPLOY_BRANCH) { $env:DEPLOY_BRANCH } else { 'main' }

$LogFile = Join-Path $PSScriptRoot 'deploy.log'

function Write-Log([string]$message) {
    Add-Content -Path $LogFile -Value "$(Get-Date -Format u) $message" -Encoding utf8
}

# $ErrorActionPreference only governs PowerShell's own errors, not exit codes from
# external commands (git/npm/pm2) — without this check a failed `git pull` would
# silently fall through to `pm2 restart`, restarting the OLD code and logging
# "Deploy complete." as if nothing were wrong.
function Assert-Success([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$step failed with exit code $LASTEXITCODE"
    }
}

# Runs a native command with its output appended to deploy.log instead of
# printed to the console. This is also what stops the command from popping a
# visible console window: this script is normally launched with no console of
# its own (spawned hidden by the deploy webhook), and an un-redirected child
# would otherwise make Windows allocate — and briefly show — a brand new one
# just to have somewhere to print to.
function Invoke-Logged([string]$Exe, [string[]]$ExeArgs) {
    Write-Log "> $Exe $($ExeArgs -join ' ')"
    # Piped into Add-Content (not `*>> $LogFile`) so this lands in the same
    # encoding as Write-Log's own lines. The `*>>` redirection operator defaults
    # to UTF-16LE in Windows PowerShell 5.1, while Add-Content defaults to
    # UTF-8 here — mixing the two in one file makes a plain-text viewer render
    # every other byte of the UTF-16 lines as a null, i.e. "Y o u r   b r a
    # n c h" instead of "Your branch".
    & $Exe @ExeArgs 2>&1 | Add-Content -Path $LogFile -Encoding utf8
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
        Write-Log 'Deploy already in progress, skipping this run.'
        exit 0
    }
    Write-Log "Stale lock file (age $([int]$age.TotalMinutes)m), reclaiming."
}
New-Item -ItemType File -Path $LockFile -Force | Out-Null

try {
    Invoke-Logged git @('fetch', 'origin')
    Assert-Success 'git fetch'
    Invoke-Logged git @('checkout', $Branch)
    Assert-Success "git checkout $Branch"

    $local = git rev-parse HEAD
    $remote = git rev-parse "origin/$Branch"

    if ($local -ne $remote) {
        Write-Log "New commits found ($local -> $remote), deploying..."
        Invoke-Logged git @('pull', 'origin', $Branch)
        Assert-Success 'git pull'
        Invoke-Logged npm @('install')
        Assert-Success 'npm install'
        Invoke-Logged npm @('run', 'build:admin')
        Assert-Success 'build:admin'
        Invoke-Logged pm2 @('restart', 'discord-bot')
        Assert-Success 'pm2 restart'
        Write-Log 'Deploy complete.'
    } else {
        Write-Log 'Up to date.'
    }
} finally {
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}
