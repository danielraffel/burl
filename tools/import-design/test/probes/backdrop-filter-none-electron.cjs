const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<body></body>');
  const result = await window.webContents.executeJavaScript(`(() => {
    const element = document.createElement('div');
    document.body.append(element);
    element.style.backdropFilter = 'blur(8px)';
    const before = getComputedStyle(element).backdropFilter;
    element.style.backdropFilter = 'none';
    const after = getComputedStyle(element).backdropFilter;
    return { before, after, inlineAfter: element.style.backdropFilter };
  })()`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  app.quit();
});
