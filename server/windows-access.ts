import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

interface AccessRequest { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
let worker: ChildProcessWithoutNullStreams | undefined;
let sequence = 0;
const pending = new Map<number, AccessRequest>();

// 2026-11-12: one pipe-bound helper amortizes PowerShell startup; checking each lock must not stall other writers.
const script = `
  $ErrorActionPreference = 'Stop'
  [Console]::InputEncoding = [Text.Encoding]::UTF8
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
      $request = ConvertFrom-Json -InputObject $line
      foreach ($target in @($request.filename, $request.parent)) {
        if (!$target) { continue }
        $acl = Get-Acl -LiteralPath $target
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user.Value) { throw 'owner' }
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
          if ($ace.AccessControlType -eq 'Allow' -and ($ace.FileSystemRights -band $write) -ne 0 -and
            $ace.IdentityReference.Value -notin @($user.Value, 'S-1-5-18', 'S-1-5-32-544')) { throw 'writers' }
        }
      }
      [Console]::WriteLine(([string]$request.id + ':ok'))
    } catch { [Console]::WriteLine(([string]$request.id + ':denied')) }
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
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  worker = child;
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
      const match = /^(\d+):(ok|denied)$/u.exec(line);
      if (!match) { failWorker(child); return; }
      const id = Number(match[1]);
      const request = pending.get(id);
      if (!request) continue;
      clearTimeout(request.timer);
      pending.delete(id);
      if (match[2] === 'ok') request.resolve();
      else request.reject(new Error('Windows access denied'));
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

export function checkWindowsAccess(filename: string, parent: string | undefined, restrict: boolean): Promise<void> {
  if (pending.size >= 256) return Promise.reject(new Error('Windows access check queue is full'));
  const child = accessWorker();
  const id = ++sequence;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => failWorker(child), 5000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, filename, parent, restrict }) + '\n');
  });
}
