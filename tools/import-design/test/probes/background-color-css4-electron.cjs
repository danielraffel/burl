const { app, BrowserWindow } = require('electron');

const values = [
  'color(srgb 0 0.0941177 0.2 / 0.35)',
  'color(srgb 0.0509804 0.0509804 0.0509804 / 0.18)',
  'color(srgb 0.0941176 0.0941176 0.0941176 / 0.8)',
  'oklab(0.301182 0.0000137091 0.00000602007 / 0.3)',
  'oklab(0.301182 0.0000137091 0.00000602007 / 0.6)',
  'oklab(0.999994 0.0000455678 0.0000200868 / 0.05)',
  'oklch(0.723 0.219 149.579)',
];
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
