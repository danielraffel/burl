const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<body></body>');
  const result = await window.webContents.executeJavaScript(`(() => {
    const cases = [
      { parentDisplay: 'flex', parentAlignItems: 'center', alignSelf: 'auto' },
      { parentDisplay: 'flex', parentAlignItems: 'center', alignSelf: 'stretch' },
      { parentDisplay: 'flex', parentAlignItems: 'center', alignSelf: 'flex-start' },
      { parentDisplay: 'flex', parentAlignItems: 'stretch', alignSelf: 'auto' },
      { parentDisplay: 'block', parentAlignItems: 'normal', alignSelf: 'auto' },
      { parentDisplay: 'list-item', parentAlignItems: 'normal', alignSelf: 'auto' },
      { parentDisplay: 'inline', parentAlignItems: 'normal', alignSelf: 'auto' },
      { parentDisplay: 'inline-block', parentAlignItems: 'normal', alignSelf: 'auto' },
    ];
    return cases.map((item) => {
      const parent = document.createElement('div');
      parent.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:100px';
      parent.style.display = item.parentDisplay;
      parent.style.alignItems = item.parentAlignItems;
      const child = document.createElement('div');
      child.style.cssText = 'width:20px;min-height:20px';
      child.style.alignSelf = item.alignSelf;
      parent.append(child);
      document.body.append(parent);
      const rect = child.getBoundingClientRect();
      parent.remove();
      return { ...item, child: { y: rect.y, width: rect.width, height: rect.height } };
    });
  })()`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  app.quit();
});
