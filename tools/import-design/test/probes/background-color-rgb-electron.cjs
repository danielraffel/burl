const { app, BrowserWindow } = require('electron');
const values = ['rgb(24, 24, 24)', 'rgb(255, 255, 255)', 'rgb(33, 33, 33)',
  'rgb(40, 40, 40)', 'rgb(46, 46, 46)', 'rgba(0, 0, 0, 0)'];
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<body></body>');
  const result = await window.webContents.executeJavaScript(`(() => ${JSON.stringify(values)}.map((input) => {
    const element = document.createElement('div');
    element.style.backgroundColor = input;
    document.body.append(element);
    return { input, computed: getComputedStyle(element).backgroundColor };
  }))()`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  app.quit();
});
