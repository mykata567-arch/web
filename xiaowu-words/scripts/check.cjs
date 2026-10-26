const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).filter(item => !['node_modules', '.local-project', '.git'].includes(item.name))
    .flatMap(item => item.isDirectory() ? walk(path.join(directory, item.name)) : [path.join(directory, item.name)]);
}
const files = walk(root);
for (const file of files) {
  if (/\.(js|cjs)$/.test(file)) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
  if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
}
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
assert.equal(app.pages[0], 'pages/words/words');
assert.equal(app.tabBar, undefined, 'V0.1不应重新加入多余主页面');
for (const page of app.pages) {
  const base = path.join(root, 'miniprogram', page);
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(base + ext), '缺少页面文件：' + page + ext);
  const controller = fs.readFileSync(base + '.js', 'utf8');
  const template = fs.readFileSync(base + '.wxml', 'utf8');
  for (const match of template.matchAll(/(?:bind(?::|catch:)?[\w-]*|catch[\w-]*)="([A-Za-z]\w*)"/g)) {
    assert.ok(new RegExp('(?:async\\s+)?' + match[1] + '\\s*\\(').test(controller), page + '缺少事件处理：' + match[1]);
  }
  const stack = [];
  for (const tag of template.matchAll(/<(\/?)([\w-]+)\b[^>]*?(\/?)>/g)) {
    if (tag[1]) assert.equal(stack.pop(), tag[2], page + '标签未配对');
    else if (!tag[3]) stack.push(tag[2]);
  }
  assert.equal(stack.length, 0, page + '有未闭合标签');
}
for (const name of ['initUser', 'wordRecords', 'reviewRecords']) {
  const dest = path.join(root, 'cloudfunctions', name, '_shared');
  for (const file of ['engine.js', 'model.js', 'date.js', 'rules.js']) assert.equal(fs.readFileSync(path.join(dest, 'domain', file), 'utf8'), fs.readFileSync(path.join(root, 'miniprogram/domain', file), 'utf8'));
  for (const file of ['handler.js', 'cloud-store.js']) assert.equal(fs.readFileSync(path.join(dest, file), 'utf8'), fs.readFileSync(path.join(root, 'cloudfunctions/_shared', file), 'utf8'));
  assert.equal(fs.readFileSync(path.join(dest, 'data/xiaowu-25.json'), 'utf8'), fs.readFileSync(path.join(root, 'seed/xiaowu-25.json'), 'utf8'));
}
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8')).appid, 'touristappid', '源码应保留AppID占位符');
assert.match(fs.readFileSync(path.join(root, 'miniprogram/config/index.js'), 'utf8'), /YOUR_CLOUD_ENV_ID/);
console.log('JS/JSON语法、页面文件/事件/标签、云函数打包一致性和配置占位符检查通过。WXML原生编译仍需微信开发者工具验证。');
