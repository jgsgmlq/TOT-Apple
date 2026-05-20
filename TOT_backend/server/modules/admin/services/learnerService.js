'use strict';

const learnerCrud = require('../crud/learnerCrud');
const storeCrud = require('../crud/storeCrud');
const resellerhqCrud = require('../crud/resellerhqCrud');
const { success, fail } = require('../../common/responseHelper');

async function getPage(req, res, next) {
  try {
    const { page = 1, pageSize = 10, keyword, sortField, sortOrder, storeAppleId, hqAppleId } = req.query;
    const result = await learnerCrud.getLearnerPage({
      page: Number(page),
      pageSize: Number(pageSize),
      keyword,
      sortField,
      sortOrder,
      storeAppleId,
      hqAppleId
    });
    res.json(success(result));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const data = req.body;
    if (!data.email_id || !data.store_apple_id) {
      return res.status(400).json(fail('email_id 和 store_apple_id 为必填字段', 400));
    }

    const exist = await learnerCrud.getLearnerByEmail(data.email_id);
    if (exist) {
      // 存在即更新逻辑
      if (!data.learner_id) data.learner_id = exist.learner_id;
      const updated = await learnerCrud.updateLearnerByEmail(data.email_id, data);
      return res.status(200).json(success(updated));
    }

    const created = await learnerCrud.createLearner(data);
    res.status(201).json(success(created));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const data = req.body;
    
    const s = await learnerCrud.getLearnerById(id);
    if (!s) {
      return res.status(404).json(fail('学员不存在', 404));
    }

    const updated = await learnerCrud.updateLearner(id, data);
    res.json(success(updated));
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const successResult = await learnerCrud.deleteLearner(id);
    if (!successResult) {
      return res.status(404).json(fail('未找到该学员', 404));
    }
    res.json(success({ deleted: true }));
  } catch (err) {
    next(err);
  }
}

// 批量上传学员数据
async function batchUpload(req, res, next) {
  try {
    const dataArray = req.body;
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json(fail('上传的数据格式无效或为空表', 400));
    }

    let importedCount = 0;

    for (const row of dataArray) {
      const mapped = {
        learner_id: row['学员 ID'] || row['学员ID'] || row.learner_id,
        email_id: row['邮箱'] || row['邮箱ID'] || row.email_id || null,
        store_apple_id: row['门店 ID'] || row['门店 Apple ID'] || row['门店Apple ID'] || row.store_apple_id || null,
        hq_apple_id: row['经销商信息 Apple ID'] || row['总部 Apple ID'] || row['总部Apple ID'] || row.hq_apple_id || null,
        rtm_level_3_name: row['RTM3'] || row['RTM 层级 3'] || row.rtm_level_3_name || null,
        rtm_level_4_name: row['RTM4'] || row['RTM 层级 4'] || row.rtm_level_4_name || null,
        vad_hq_name: row['VAD/HQ Name'] || row['VAD/HQ 名称'] || row.vad_hq_name || null,
        hq_reseller_localized_name: row['经销商中文名'] || row.hq_reseller_localized_name || null,
        reseller_localized_name: row['门店中文名'] || row.reseller_localized_name || null,
        sales_name: row['销售姓名'] || row.sales_name || null,
        user_business_role_name: row['业务角色'] || row.user_business_role_name || null,
        apple_role_name: row['Apple角色'] || row['Apple 角色'] || row.apple_role_name || null,
        first_login_date: row['首次登录日期'] || row.first_login_date || null,
        // 按照用户要求：如果缺失则默认设为 1
        user_enabled_indicator: (row['是否启用'] !== undefined && row['是否启用'] !== '') 
          ? (row['是否启用'] === '1' || row['是否启用'] === 1 || row['是否启用'] === true ? 1 : 0) 
          : 1
      };

      // 按照用户要求：只有学员 ID 是必填
      if (!mapped.learner_id) continue;

      // 如果有首次登录日期，清洗日期格式为合法 datetime
      if (mapped.first_login_date) {
        mapped.first_login_date = mapped.first_login_date.replace(/\//g, '-').replace('T', ' ').substring(0, 19);
      }

      // 如果有邮箱，则尝试 Upsert；如果没有邮箱，则直接创建新记录（因为目前的 Upsert 依赖邮箱识别）
      const exist = mapped.email_id ? await learnerCrud.getLearnerByEmail(mapped.email_id) : null;
      if (exist) {
        await learnerCrud.updateLearnerByEmail(mapped.email_id, mapped);
      } else {
        await learnerCrud.createLearner(mapped);
      }
      importedCount++;
    }
    
    res.json(success({ importedCount }));
  } catch (err) {
    next(err);
  }
}

async function batchDelete(req, res, next) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json(fail('未选择任何学员', 400, 'BAD_REQUEST'));
    }

    let successCount = 0;
    for (const id of ids) {
      // 1. 先捞取学员详情，获取 email_id 用于关联表清理
      const learner = await learnerCrud.getLearnerById(id);
      if (learner) {
        // 2. 彻底清理该学员在所有业务表（任务、队列、催办）中的踪迹
        await learnerCrud.deleteLearnerTaskAssignments(learner.learner_id, learner.email_id);
      }
      
      // 3. 物理删除学员账户
      const ok = await learnerCrud.deleteLearner(id);
      if (ok) successCount++;
    }

    // 学员账户模块现在不返回 failures 数组，直接返回成功总数
    res.json(success({ successCount, count: successCount }));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPage,
  create,
  update,
  remove,
  batchUpload,
  batchDelete
};
