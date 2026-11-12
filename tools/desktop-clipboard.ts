import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defineText, serverText } from '../server/i18n.ts';

const messages = defineText({
  unavailable: (code: number) => `Windows clipboard is unavailable (OpenClipboard error ${code}); repeat clipboard checks in an interactive desktop session.`,
  probeFailed: 'Could not check Windows clipboard access; repeat clipboard checks in an interactive desktop session.',
}, {
  unavailable: (code: number) => `Буфер обмена Windows недоступен (ошибка OpenClipboard ${code}); повторите проверки буфера в интерактивном сеансе рабочего стола.`,
  probeFailed: 'Не удалось проверить доступ к буферу обмена Windows; повторите проверки буфера в интерактивном сеансе рабочего стола.',
});

export type ClipboardAvailability = { available: true } | { available: false; reason: string };

/** 2026-11-12: a successful WebView write promise does not prove access to the window station's clipboard. */
export function clipboardAvailability(): ClipboardAvailability {
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const output = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference = 'Stop'
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DeckmateClipboard {
        [DllImport("user32.dll", SetLastError=true)] public static extern bool OpenClipboard(IntPtr window);
        [DllImport("user32.dll")] public static extern bool CloseClipboard();
      }';
      $opened = [DeckmateClipboard]::OpenClipboard([IntPtr]::Zero);
      $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error();
      if ($opened) { [void][DeckmateClipboard]::CloseClipboard(); }
      @{ available = $opened; code = $code } | ConvertTo-Json -Compress;
    `], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    const result: unknown = JSON.parse(output);
    if (result && typeof result === 'object' && 'available' in result) {
      if (result.available === true) return { available: true };
      if (result.available === false && 'code' in result && typeof result.code === 'number') {
        return { available: false, reason: serverText(messages).unavailable(result.code) };
      }
    }
  } catch { /* 2026-11-12: inability to probe is an explicit environment skip, never a passed clipboard check. */ }
  return { available: false, reason: serverText(messages).probeFailed };
}
