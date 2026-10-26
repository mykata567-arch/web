const { stageLabel } = require('../domain/model');

function requestId() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12) + '_' + Math.random().toString(36).slice(2, 8);
}

function presentWord(word, day) {
  return { ...word, phraseText: word.phrases.join('、'), stageLabel: stageLabel(word), due: !word.mastered && word.nextReviewDate <= day,
    nextLabel: word.mastered ? '已阶段性掌握' : word.nextReviewDate <= day ? '今天待复习' : word.nextReviewDate + ' 复习' };
}

function showError(error) {
  const message = error && error.message ? error.message : '操作未成功，请重试';
  wx.showModal({ title: '暂时没有完成', content: message, showCancel: false });
}

function historyText(record) {
  if (record.type === 'seed') return '导入初始错字 · 出错' + record.occurrences + '次';
  if (record.type === 'mistake') return '再次记录听写错误 · 出错' + record.occurrences + '次';
  return record.correct ? (record.afterMastered ? '答对 · 阶段性掌握' : '答对 · 连续' + record.afterStreak + '次') : '答错 · 明天再复习';
}

module.exports = { requestId, presentWord, showError, historyText };
