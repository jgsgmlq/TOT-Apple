'use strict';

const express = require('express');
const router = express.Router();
const resellerhqService = require('../services/resellerhqService');
const { authenticate, requireRole } = require('../../common/middleware/auth');

router.use(authenticate);

// ─── 经销商总部 API ─────────────────────────────────────────────────────────────

/**
 * @route GET /api/v1/data-import/reseller_hq/page
 * @description 分页获取经销商总部列表（支持模糊搜索与多字段筛选排序）
 * @access central, admin, executive
 * @usage 专供前端“数据中心 - 经销商信息”面板的表格核心数据渲染及分页切换。
 */
router.get('/reseller_hq/page', requireRole(['central', 'admin', 'executive']), async function(req, res, next) {
  try {
    await resellerhqService.getPage(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route GET /api/v1/data-import/reseller_hq/options
 * @description 获取经销商表格的筛选项去重枚举列表（如国家/地区、渠道类型）
 * @access central, admin, executive
 * @usage 渲染前端表格表头或上方的筛选下拉菜单，供用户快捷过滤数据。
 */
router.get('/reseller_hq/options', requireRole(['central', 'admin', 'executive']), async function(req, res, next) {
  try {
    await resellerhqService.getOptions(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /api/v1/data-import/reseller_hq
 * @description 新增单个经销商总部记录
 * @access central, admin
 * @usage 用户在数据中心点击“新增数据”填完表单后，点击“确认新增”时触发的数据入库操作。
 */
router.post('/reseller_hq', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await resellerhqService.create(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route PUT /api/v1/data-import/reseller_hq/:id
 * @description 更新指定的经销商总部信息
 * @access central, admin
 * @usage 用户在数据中心点击某行经销商记录的“编辑”，修改相关字段并“保存修改”时触发。
 */
router.put('/reseller_hq/:id', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await resellerhqService.update(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route DELETE /api/v1/data-import/reseller_hq/:id
 * @description 删除指定的经销商总部记录
 * @access central, admin
 * @usage 在经销商信息表格的右侧操作列点击“删除”按钮时，物理移除该行数据。
 */
router.delete('/reseller_hq/:id', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await resellerhqService.remove(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /api/v1/data-import/reseller_hq/batch
 * @description 批量上传导入经销商数据
 * @access central, admin
 * @usage 在数据中心通过上传 CSV 文件，解析为 JSON 数组后调用此接口。支持中文表头智能映射及“存在即覆盖更新、不存在即插入(Upsert)”的健壮逻辑。
 */
router.post('/reseller_hq/batch', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await resellerhqService.batchUpload(req, res, next);
  } catch (e) {
    next(e);
  }
});

/**
 * @route POST /api/v1/data-import/reseller_hq/batch-delete
 * @description 批量删除经销商
 * @access central, admin
 */
router.post('/reseller_hq/batch-delete', requireRole(['central', 'admin']), async function(req, res, next) {
  try {
    await resellerhqService.batchDelete(req, res, next);
  } catch (e) {
    next(e);
  }
});


module.exports = router;
