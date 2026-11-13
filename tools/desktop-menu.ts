// 2026-11-13: both the native client and the WebView2 child must stay fixed when submenu contents change.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

type Rect = { x: number; y: number; width: number; height: number };
export type MenuLayout = { window: number; menu: number; client: Rect; content: Rect };

export function menuLayout(pid: number, handle = 0): MenuLayout {
  return JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference = 'Stop';
    Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class DeckmateMenuLayout {
      public delegate bool Visitor(IntPtr hwnd, IntPtr data);
      [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd, Visitor visitor, IntPtr data);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int count);
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
      [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hwnd);
      [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
      [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Bounds bounds);
      public struct Point { public int x; public int y; }
      public struct Bounds { public int left; public int top; public int right; public int bottom; }
      public struct Rect { public int x; public int y; public int width; public int height; }
      public static Rect Measure(IntPtr hwnd) {
        var point = new Point(); Bounds bounds;
        if (hwnd == IntPtr.Zero || !ClientToScreen(hwnd, ref point) || !GetClientRect(hwnd, out bounds)) throw new Exception("Client bounds not found");
        return new Rect { x=point.x, y=point.y, width=bounds.right-bounds.left, height=bounds.bottom-bounds.top };
      }
      public static IntPtr Content(IntPtr parent) {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (hwnd, data) => {
          var name = new StringBuilder(256); GetClassNameW(hwnd, name, name.Capacity);
          if (name.ToString() == "Chrome_WidgetWin_0") { found = hwnd; return false; } return true;
        }, IntPtr.Zero);
        return found;
      }
    }';
    $window = [IntPtr]::new(${handle});
    if ($window -eq [IntPtr]::Zero) { $window = (Get-Process -Id ${pid}).MainWindowHandle; }
    [uint32]$owner = 0;
    [void][DeckmateMenuLayout]::GetWindowThreadProcessId($window, [ref]$owner);
    if ($owner -ne ${pid}) { throw 'Target is not an owned window'; }
    $menu = [DeckmateMenuLayout]::GetMenu($window);
    if ($menu -eq [IntPtr]::Zero) { throw 'Native menu not found'; }
    @{ window=$window.ToInt64(); menu=$menu.ToInt64(); client=[DeckmateMenuLayout]::Measure($window);
       content=[DeckmateMenuLayout]::Measure([DeckmateMenuLayout]::Content($window)) } | ConvertTo-Json -Compress;
  `], { encoding: 'utf8', timeout: 15_000, windowsHide: true }));
}

export function assertMenuStable(before: MenuLayout, after: MenuLayout, action: string) {
  assert.equal(after.window, before.window, `${action}: HWND changed`);
  assert.equal(after.menu, before.menu, `${action}: HMENU changed`);
  assert.deepEqual(after.client, before.client, `${action}: native client moved or resized`);
  assert.deepEqual(after.content, before.content, `${action}: WebView2 content moved or resized`);
  return { menuBefore: before.menu, menuAfter: after.menu,
    clientShift: { x: after.client.x - before.client.x, y: after.client.y - before.client.y },
    contentShift: { x: after.content.x - before.content.x, y: after.content.y - before.content.y } };
}
