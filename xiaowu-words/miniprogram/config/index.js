// V0.1 使用真实云端，不会自动降级为本地数据。
// 运行 node scripts/configure.cjs --appid ... --env ... 写入私有配置。
module.exports = {
  mode: 'cloud',
  cloudEnv: 'YOUR_CLOUD_ENV_ID'
};
