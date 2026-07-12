const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<body></body>');
  const result = await window.webContents.executeJavaScript(`(() => {
    const element = document.createElement('div');
    element.style.backgroundColor = 'color(srgb 0 0 0 / 0)';
    document.body.append(element);
    return {
      inline: element.style.backgroundColor,
      computed: getComputedStyle(element).backgroundColor,
    };
  })()`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  app.quit();
});
