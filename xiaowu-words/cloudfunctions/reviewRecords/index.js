const cloud = require('wx-server-sdk');
exports.main = require('./_shared/handler').createHandler('reviewRecords', cloud);
