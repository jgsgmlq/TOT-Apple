'use strict';

const campaignCrud = require('../crud/campaignCrud');
const { success, fail } = require('../../common/responseHelper');

async function getPage(req, res, next) {
  try {
    const { page = 1, pageSize = 10, fiscal_year, quarter_no, model_type, rtm_scope, topicName, sortField, sortOrder, keyword } = req.query;
    const result = await campaignCrud.getCampaignPage({
      page: Number(page),
      pageSize: Number(pageSize),
      fiscal_year,
      quarter_no,
      model_type,
      rtm_scope,
      topicName,
      sortField,
      sortOrder,
      keyword
    });
    res.json(success(result));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const data = req.body;
    const created = await campaignCrud.createCampaign({
      activity_id: data.activity_id || `ACT-${Date.now()}`,
      task_week: data.task_week,
      topic_name: data.topic_name,
      fiscal_year: data.fiscal_year,
      quarter_no: data.quarter_no,
      week_code: data.week_code,
      date_range: data.date_range,
      model_type: data.model_type,
      rtm_scope: data.rtm_scope
    });
    res.json(success(created));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json(fail('活动ID已存在', 400, 'DB_DUP_ENTRY'));
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const data = req.body;
    const updated = await campaignCrud.updateCampaign(id, data);
    res.json(success(updated));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json(fail('活动ID冲突', 400, 'DB_DUP_ENTRY'));
    }
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const successResult = await campaignCrud.deleteCampaign(id);
    if (!successResult) {
      return res.status(404).json(fail('未找到该活动信息', 404, 'NOT_FOUND'));
    }
    res.json(success({ success: true }));
  } catch (err) {
    next(err);
  }
}

async function batchUpload(req, res, next) {
  try {
    const dataArray = req.body;
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json(fail('上传的数据格式无效或为空表', 400, 'BAD_REQUEST'));
    }
    
    // 按照用户要求：累加模式，不进行 ID 检查
    // 直接调用 CRUD 层封装的批量插入逻辑
    const importedCount = await campaignCrud.batchUpsertCampaign(dataArray);
    
    res.json(success({ importedCount }));
  } catch (err) {
    next(err);
  }
}

async function batchDelete(req, res, next) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(fail('未选择任何活动', 400, 'BAD_REQUEST'));
    }
    const count = await campaignCrud.batchDeleteCampaign(ids);
    res.json(success({ count }));
  } catch (err) {
    next(err);
  }
}

async function getOptions(req, res, next) {
  try {
    const result = await campaignCrud.getFilterOptions();
    res.json(success(result));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getOptions,
  getPage,
  create,
  update,
  remove,
  batchUpload,
  batchDelete
};
