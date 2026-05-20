'use strict';

const express = require('express');
const storeService = require('../services/storeService');
const { authenticate, requireRole } = require('../../common/middleware/auth');
const { success } = require('../../common/responseHelper');

const router = express.Router();
router.use(authenticate);

/**
 * @route GET /
 * @description 获取门店列表（支持多条件筛选限制返回条数）
 * @access central, admin, executive
 * @usage 常用于系统内下拉选择、门店列表导出等非严格分页的场景。
 */
router.get('/', requireRole(['central', 'admin', 'executive']), async function(req, res, next) {
  try {
    const o = { rtm4: req.query.rtm4, hqAppleId: req.query.hqAppleId, subRegion: req.query.subRegion, limit: +req.query.limit || 200 };
    const r = await storeService.getStoreList(o);
    res.json(success(r));
  } catch (e) { next(e); }
});

/**
 * @route GET /page
 * @description 分页获取门店列表（支持模糊搜索与字段排序）
 * @access central, admin, executive
 * @usage 专供总部端“数据中心 - 门店信息”面板的表格数据展示。
 */
router.get('/page', requireRole(['central', 'admin', 'executive']), async function(req, res, next) {
  try {
    const o = {
      ...req.query,
      page: +req.query.page || 1,
      pageSize: +req.query.pageSize || 10
    };
    const r = await storeService.getStorePage(o);
    res.json(success(r));
  } catch (e) { next(e); }
});

/**
 * @route POST /batch
 * @description 批量导入门店数据
 * @access central, admin
 * @usage 在数据中心通过上传 CSV 文件，解析为 JSON 数组后调用此接口。内部自动根据 store_apple_id 执行存在即更新，不存在则插入的逻辑。
 */
router.post('/batch', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    const result = await storeService.batchUploadStore(req.body);
    res.json(success(result));
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /batch-delete
 * @description 批量删除门店
 * @access central, admin
 */
router.post('/batch-delete', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    const { ids } = req.body;
    const result = await storeService.batchDelete(ids);
    res.json(success(result));
  } catch (e) {
    next(e);
  }
});

/**
 * @route GET /:id
 * @description 根据门店数据库内部主键 (reseller_store_id) 查询单条详情
 * @access central, admin, executive
 * @usage 用于门店编辑弹窗的数据回显或详细信息查看。
 */
router.get('/:id', requireRole(['central', 'admin', 'executive']), async function(req, res, next) {
  try {
    res.json(success(await storeService.getStoreById(req.params.id)));
  } catch (e) { next(e); }
});

/**
 * @route POST /
 * @description 新增单个门店记录
 * @access central, admin
 * @usage 在数据中心点击“新增数据”填完表单后触发。
 */
router.post('/', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    const s = await storeService.createStore(req.body);
    res.status(201).json(success(s));
  } catch (e) { next(e); }
});

/**
 * @route PUT /:id
 * @description 更新指定门店的信息
 * @access central, admin
 * @usage 在数据中心点击“编辑”，修改门店字段后触发。
 */
router.put('/:id', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    const s = await storeService.updateStore(req.params.id, req.body);
    res.json(success(s));
  } catch (e) { next(e); }
});

/**
 * @route DELETE /:id
 * @description 删除指定门店记录
 * @access central, admin
 * @usage 在数据中心的门店表格操作列点击“删除”按钮时触发。
 */
router.delete('/:id', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await storeService.deleteStore(req.params.id);
    res.json(success({ deleted: true }));
  } catch (e) { next(e); }
});

module.exports = router;
