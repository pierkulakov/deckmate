import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

interface AccessRequest { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
let worker: ChildProcessWithoutNullStreams | undefined;
// 2026-11-13: a cold Windows PowerShell under parallel load (four test workers, a busy CI runner) can need well over
// five seconds before its first answer; once it has answered, a slow reply means a stuck helper.
let workerAnswered = false;
const coldReplyMs = 20_000;
const warmReplyMs = 5_000;
let sequence = 0;
const pending = new Map<number, AccessRequest>();

// 2026-11-12: one pipe-bound helper amortizes PowerShell startup; checking each lock must not stall other writers.
// 2026-11-13: SYSTEM and Administrators can change any file anyway, so they are trusted owners and writers; the check
// keeps out other ordinary users. An elevated process owns new files through the Administrators group, and a profile's
// Temp folder may belong to SYSTEM. Inherit-only entries grant nothing on the object itself. A denial names its reason.
const script = `
  $ErrorActionPreference = 'Stop'
  [Console]::InputEncoding = [Text.Encoding]::UTF8
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $trusted = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try { $request = ConvertFrom-Json -InputObject $line } catch { [Console]::WriteLine(':denied:request'); continue }
    # A concurrent Set-Acl from another Deckmate process can fail a read for a moment; only an untrusted owner or writer
    # is a verdict, anything else is retried twice before it counts as a denial.
    for ($attempt = 1; ; $attempt++) {
    try {
      foreach ($target in @($request.filename, $request.parent)) {
        if (!$target) { continue }
        $acl = Get-Acl -LiteralPath $target
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -notin $trusted) { throw ('owner-' + $owner) }
        if ($request.restrict -and $target -eq $request.filename) {
          $private = New-Object Security.AccessControl.DirectorySecurity
          $private.SetOwner($user)
          $private.SetAccessRuleProtection($true, $false)
          foreach ($sid in @($user.Value, 'S-1-5-18', 'S-1-5-32-544')) {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule(
              (New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $private.AddAccessRule($rule)
          }
          Set-Acl -LiteralPath $target -AclObject $private
          $acl = Get-Acl -LiteralPath $target
        }
        $write = [Security.AccessControl.FileSystemRights]::Write -bor
          [Security.AccessControl.FileSystemRights]::Delete -bor
          [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
          [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
          [Security.AccessControl.FileSystemRights]::TakeOwnership
        foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
          if (($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
          if ($ace.AccessControlType -eq 'Allow' -and ($ace.FileSystemRights -band $write) -ne 0 -and
            $ace.IdentityReference.Value -notin $trusted) { throw ('writer-' + $ace.IdentityReference.Value) }
        }
      }
      [Console]::WriteLine(([string]$request.id + ':ok'))
      break
    } catch {
      $reason = ([string]$_.Exception.Message -replace '[^A-Za-z0-9-]', '')
      if ($reason -notmatch '^(owner|writer)-' -and $attempt -lt 3) { Start-Sleep -Milliseconds (50 * $attempt); continue }
      if ($reason.Length -gt 80) { $reason = $reason.Substring(0, 80) }
      [Console]::WriteLine(([string]$request.id + ':denied:' + $reason))
      break
    }
    }
  }
`;

function failWorker(child: ChildProcessWithoutNullStreams): void {
  if (worker !== child) return;
  worker = undefined;
  child.kill();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error('Windows access check failed'));
  }
  pending.clear();
}

function accessWorker(): ChildProcessWithoutNullStreams {
  if (worker) return worker;
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // 2026-11-13: a PowerShell 7 parent leaves its PSModulePath behind, and Windows PowerShell then cannot load Get-Acl;
  // without the variable it builds its own default module path.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
  // 2026-11-13: the long-lived helper must not hold the project or a temporary folder as its working directory,
  // or Windows refuses to rename or remove that folder while the helper lives.
  const cwd = path.dirname(executable);
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env, cwd });
  worker = child;
  workerAnswered = false;
  let received = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    received += chunk;
    if (received.length > 16_384) { failWorker(child); return; }
    for (;;) {
      const newline = received.indexOf('\n');
      if (newline < 0) break;
      const line = received.slice(0, newline).trim();
      received = received.slice(newline + 1);
      const match = /^(\d+):(ok|denied)(?::([A-Za-z0-9-]{0,80}))?$/u.exec(line);
      if (!match) { failWorker(child); return; }
      if (worker === child) workerAnswered = true;
      const id = Number(match[1]);
      const request = pending.get(id);
      if (!request) continue;
      clearTimeout(request.timer);
      pending.delete(id);
      if (match[2] === 'ok') request.resolve();
      else request.reject(new Error(`Windows access denied${match[3] ? ` (${match[3]})` : ''}`));
    }
  });
  child.stderr.resume();
  child.on('error', () => failWorker(child));
  child.on('exit', () => failWorker(child));
  child.stdin.on('error', () => failWorker(child));
  // 2026-11-12: pending checks own their timeout; idle pipes must not keep a CLI or Vitest worker alive.
  child.unref();
  for (const pipe of [child.stdin, child.stdout, child.stderr]) {
    if ('unref' in pipe && typeof pipe.unref === 'function') pipe.unref();
  }
  return child;
}

/** 2026-11-13: starting the helper early hides its cold start from the first write after a server starts. */
export function warmWindowsAccess(): void {
  if (process.platform === 'win32') accessWorker();
}

/** 2026-11-13: a closing server must not stay alive for a pending cold check; other writers in the process keep theirs. */
export function closeWindowsAccess(): void {
  for (const request of pending.values()) request.timer.unref();
}

export function checkWindowsAccess(filename: string, parent: string | undefined, restrict: boolean): Promise<void> {
  if (pending.size >= 256) return Promise.reject(new Error('Windows access check queue is full'));
  const child = accessWorker();
  const id = ++sequence;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => failWorker(child), workerAnswered ? warmReplyMs : coldReplyMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, filename, parent, restrict }) + '\n');
  });
}
