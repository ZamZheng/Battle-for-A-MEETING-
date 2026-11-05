function error(page, err) { page.setData({ error:err.message || '操作失败，请重试' }); }
function confirm(content, title = '请确认') {
  return new Promise(resolve => wx.showModal({ title, content, success:r=>resolve(r.confirm), fail:()=>resolve(false) }));
}
module.exports = { error, confirm };
