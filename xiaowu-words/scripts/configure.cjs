const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const root = path.resolve(__dirname, '..');

(async () => {
  const args = process.argv.slice(2);
  const arg = key => args.includes(key) ? args[args.indexOf(key) + 1] : '';
  let appid = arg('--appid');
  let env = arg('--env');
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!appid) appid = (await input.question('小程序AppID（wx开头）：')).trim();
    if (!env) env = (await input.question('微信云开发环境ID：')).trim();
  } finally { input.close(); }
  if (!/^wx[a-f0-9]{16}$/.test(appid) || !/^[a-zA-Z0-9_-]{3,100}$/.test(env) || env === 'YOUR_CLOUD_ENV_ID') throw new Error('AppID或环境ID格式不正确');
  const output = path.join(root, '.local-project');
  fs.mkdirSync(output, { recursive: true });
  for (const dir of ['miniprogram', 'cloudfunctions']) fs.cpSync(path.join(root, dir), path.join(output, dir), { recursive: true, filter: source => !source.split(path.sep).includes('node_modules') });
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  config.appid = appid;
  fs.writeFileSync(path.join(output, 'project.config.json'), JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'miniprogram/config/index.js'), 'module.exports = ' + JSON.stringify({ mode: 'cloud', cloudEnv: env }, null, 2) + ';\n');
  console.log('配置完成。在微信开发者工具中导入 xiaowu-words/.local-project 目录。原始源码仍保留占位符。');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
