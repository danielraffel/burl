const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<body></body>');
  const result = await window.webContents.executeJavaScript(`(() => {
    const displays = ['flex', 'block', 'list-item', 'inline', 'inline-block'];
    const values = ['normal', 'stretch', 'flex-start'];
    const output = {};
    for (const display of displays) {
      output[display] = {};
      for (const alignItems of values) {
        const parent = document.createElement('div');
        parent.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:100px';
        parent.style.display = display;
        parent.style.alignItems = alignItems;
        const child = document.createElement('div');
        child.style.cssText = 'min-height:20px';
        child.textContent = 'X';
        parent.append(child);
        document.body.append(parent);
        const rect = child.getBoundingClientRect();
        output[display][alignItems] = { y: rect.y, width: rect.width, height: rect.height };
        parent.remove();
      }
    }
    return output;
  })()`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  app.quit();
});
