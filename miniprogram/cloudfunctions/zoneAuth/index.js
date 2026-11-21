// 微信云开发无感身份函数：在云端安全获取用户 OPENID，前端不暴露 AppSecret
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID, UNIONID } = cloud.getWXContext();
  return { openid: OPENID || '', unionid: UNIONID || '' };
};
