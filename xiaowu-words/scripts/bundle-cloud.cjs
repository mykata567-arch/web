const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const functions = ['initUser', 'wordRecords', 'reviewRecords'];

for (const name of functions) {
  const destination = path.join(root, 'cloudfunctions', name, '_shared');
  fs.mkdirSync(destination, { recursive: true });
  for (const file of ['handler.js', 'cloud-store.js']) fs.copyFileSync(path.join(root, 'cloudfunctions/_shared', file), path.join(destination, file));
  fs.cpSync(path.join(root, 'miniprogram/domain'), path.join(destination, 'domain'), { recursive: true });
  fs.mkdirSync(path.join(destination, 'data'), { recursive: true });
  fs.copyFileSync(path.join(root, 'seed/xiaowu-25.json'), path.join(destination, 'data/xiaowu-25.json'));
}
console.log('已生成3个可独立上传的云函数包。');
