const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
app.commandLine.appendSwitch('autoplay-policy', 'user-gesture-required');
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  const b64 = fs.readFileSync('/Users/danielnelson/Downloads/12902302-hd_1080_1920_30fps.mp4').toString('base64');
  const w = new BrowserWindow({ show: false });
  w.loadURL('data:text/html,<body></body>');
  w.webContents.once('did-finish-load', async () => {
    try {
      const r = await w.webContents.executeJavaScript(`(async () => {
        const bin = atob(B64DATA);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([u], { type: 'video/mp4' }));
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        v.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;';  // the app's occluded style
        document.body.appendChild(v);
        v.src = url;
        await new Promise((res) => v.addEventListener('loadeddata', res, { once: true }));
        const c = document.createElement('canvas'); c.width = 320; c.height = 568;
        const cx = c.getContext('2d');
        const grab = () => { cx.clearRect(0,0,320,568); try { cx.drawImage(v, 0, 0, 320, 568); } catch (e) { return 'draw-err'; }
          const d = cx.getImageData(0,0,320,568).data; let s=0,n=0;
          for (let i = 0; i < d.length; i += 397*4) { s += d[i]+d[i+1]+d[i+2]; n++; } return +(s/n/3).toFixed(1); };
        const seek = (t) => new Promise((res) => { const f = () => res('seeked'); v.addEventListener('seeked', f, { once: true });
          setTimeout(() => { v.removeEventListener('seeked', f); res('timeout'); }, 1500); v.currentTime = t; });
        const out = [];
        out.push(['fresh loadeddata', v.currentTime, grab()]);
        out.push(['seek 0.01', await seek(0.01), v.currentTime, grab()]);
        out.push(['seek 0.5', await seek(0.5), v.currentTime, grab()]);
        out.push(['seek 0.002 back', await seek(0.002), v.currentTime, grab()]);
        out.push(['seek 0', await seek(0), v.currentTime, grab()]);
        const p = await v.play().then(() => 'played', (e) => 'rejected:' + e.name);
        await new Promise((r2) => setTimeout(r2, 120)); v.pause();
        out.push(['after play attempt', p, v.currentTime, grab()]);
        const rv = await new Promise((res) => { let done = false;
          v.requestVideoFrameCallback?.(() => { done = true; res('rVFC-fired'); });
          v.currentTime = 0.8; setTimeout(() => { if (!done) res('rVFC-silent'); }, 1200); });
        out.push(['seek 0.8 + rVFC', rv, v.currentTime, grab()]);
        // visibility test: make it visible, seek again
        v.style.opacity = '0.01';
        out.push(['visible seek 1.2', await seek(1.2), v.currentTime, grab()]);
        return JSON.stringify(out);
      })()`.replace('B64DATA', JSON.stringify(b64)));
      console.log('[probe]', r);
    } catch (e) { console.log('[probe-err]', e.message.slice(0, 300)); }
    app.quit();
  });
});
