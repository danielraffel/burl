const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<body></body>');
  const result = await window.webContents.executeJavaScript(`(() => {
    const generic = document.createElement('div');
    generic.style.borderBottom = '1px solid oklab(0.301182 0.0000137091 0.00000602007 / 0.6)';
    document.body.append(generic);
    const promoted = document.createElement('button');
    promoted.style.cssText = 'border:0;border-left:1px solid oklab(0.301182 0.0000137091 0.00000602007 / 0.6)';
    document.body.append(promoted);
    const g = getComputedStyle(generic), p = getComputedStyle(promoted);
    return { generic: { width: g.borderBottomWidth, color: g.borderBottomColor },
      promoted: { widths: [p.borderTopWidth,p.borderRightWidth,p.borderBottomWidth,p.borderLeftWidth], color: p.borderLeftColor } };
  })()`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); app.quit();
});
