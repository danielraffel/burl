const { app, BrowserWindow } = require('electron');
const values = ['1px solid oklab(0.301182 0.0000137091 0.00000602007 / 0.6)', '1px solid rgb(46, 46, 46)'];
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<body></body>');
  const result = await window.webContents.executeJavaScript(`(() => ${JSON.stringify(values)}.map((input) => {
    const element = document.createElement('button'); element.style.border = input;
    document.body.append(element); const style = getComputedStyle(element);
    return { input, border: style.border, width: style.borderWidth, color: style.borderColor };
  }))()`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); app.quit();
});
