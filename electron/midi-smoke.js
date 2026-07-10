const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const w = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  w.loadURL('data:text/html,<html><body>midi test</body></html>');
  w.webContents.once('did-finish-load', async () => {
    const r = await w.webContents.executeJavaScript(`
      Promise.race([
        navigator.requestMIDIAccess().then(() => 'RESOLVED', (e) => 'REJECTED: ' + e.name),
        new Promise((res) => setTimeout(() => res('HUNG (no settle in 4s)'), 4000)),
      ])
    `);
    console.log('[test] requestMIDIAccess →', r);
    app.quit();
  });
});
