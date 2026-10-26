// 修改后运行 npm run build:cloud 并重新部署三个云函数。
export default Object.freeze({
  firstDelayDays: 1,
  correctIntervalsDays: Object.freeze([3, 7, 14]),
  sessionSize: 10
});
