// Renders docs/social-preview.html of the Deckmate repository to a 1280×640 PNG with Electron.
// Run: node_modules\electron\dist\electron.exe capture\capture-social.mjs <repo>\docs\social-preview.html <out.png>  (2026-11-08)
import { app, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , source, target] = process.argv;
if (!source || !target) { console.error('usage: capture-social.mjs <social-preview.html> <out.png>'); app.exit(2); }

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 640, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(path.resolve(source));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 400)))');
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 640 });
  const png = image.toPNG();
  await writeFile(path.resolve(target), png);
  console.log(`saved ${target} ${image.getSize().width}x${image.getSize().height} ${(png.length / 1024).toFixed(0)} KB`);
  win.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
