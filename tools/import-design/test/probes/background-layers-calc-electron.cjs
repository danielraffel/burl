const { app, BrowserWindow } = require('electron');
const value = 'linear-gradient(90deg, rgba(0, 0, 0, 0) calc(50% - 30px), rgb(24, 24, 24), rgba(0, 0, 0, 0) calc(50% + 30px)), linear-gradient(rgb(175, 175, 175), rgb(175, 175, 175))';
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<body></body>');
  const result = await window.webContents.executeJavaScript(`(() => {
    const element = document.createElement('div');
    element.style.backgroundImage = ${JSON.stringify(value)};
    document.body.append(element);
    return { inline: element.style.backgroundImage, computed: getComputedStyle(element).backgroundImage };
  })()`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  app.quit();
});
