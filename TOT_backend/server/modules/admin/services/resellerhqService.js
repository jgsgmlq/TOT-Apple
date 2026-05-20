'use strict';

const resellerhqCrud = require('../crud/resellerhqCrud');
const { success, fail } = require('../../common/responseHelper');

async function getPage(req, res, next) {
  try {
    const { page = 1, pageSize = 10, country_region_name, rtm4_name, resellerName, sortField, sortOrder, keyword } = req.query;
    const result = await resellerhqCrud.getResellerHqPage({
      page: Number(page),
      pageSize: Number(pageSize),
      country_region_name,
      rtm4_name,
      resellerName,
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
    // 假设前端生成的 id 或由后端生成，如果在 MySQL 中有自增则无需传入，此处以传入为主
    const created = await resellerhqCrud.createResellerHq({
      reseller_hq_id: data.reseller_hq_id || `HQ-${Date.now()}`,
      hq_apple_id: data.hq_apple_id,
      country_region_name: data.country_region_name,
      sub_region_code: data.sub_region_code,
      rtm4_name: data.rtm4_name,
      contract_id: data.contract_id,
      reseller_name: data.reseller_name,
      reseller_name_localized: data.reseller_name_localized,
      vad_hq_name: data.vad_hq_name
    });
    res.json(success(created));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json(fail('经销商ID或Apple ID已存在', 400, 'DB_DUP_ENTRY'));
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const data = req.body;
    const updated = await resellerhqCrud.updateResellerHq(id, data);
    res.json(success(updated));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json(fail('经销商ID或Apple ID冲突', 400, 'DB_DUP_ENTRY'));
    }
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const successResult = await resellerhqCrud.deleteResellerHq(id);
    if (!successResult) {
      return res.status(404).json(fail('未找到该经销商信息', 404, 'NOT_FOUND'));
    }
    res.json(success({ success: true }));
  } catch (err) {
    next(err);
  }
}

//上传表格数据：支持中文表头映射和存在即更新逻辑
async function batchUpload(req, res, next) {
  try {
    const dataArray = req.body;
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json(fail('上传的数据格式无效或为空表', 400, 'BAD_REQUEST'));
    }
    
    let importedCount = 0;
    for (const row of dataArray) {
      const mapped = {
        reseller_hq_id: row['经销商 ID'] || row['经销商ID'] || row.reseller_hq_id,
        hq_apple_id: row['Apple ID'] || row['总部 Apple ID'] || row['总部Apple ID'] || row.hq_apple_id,
        country_region_name: row['国家/地区'] || row.country_region_name,
        sub_region_code: row['子区域编码'] || row.sub_region_code,
        rtm4_name: row['渠道类型'] || row.rtm4_name,
        contract_id: row['合同 ID'] || row['合同ID'] || row.contract_id,
        reseller_name: row['经销商英文名'] || row.reseller_name,
        reseller_name_localized: row['经销商中文名'] || row.reseller_name_localized,
        vad_hq_name: row['VAD/HQ 名称'] || row['VAD/HQ Name'] || row.vad_hq_name
      };

      if (!mapped.hq_apple_id) continue;

      if (!mapped.reseller_hq_id) {
        mapped.reseller_hq_id = mapped.hq_apple_id; // fallback
      }

      const exist = await resellerhqCrud.getResellerHqByAppleId(mapped.hq_apple_id);
      if (exist) {
        await resellerhqCrud.updateResellerHq(exist.reseller_hq_id, mapped);
      } else {
        await resellerhqCrud.createResellerHq(mapped);
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
      return res.status(400).json(fail('未选择任何经销商', 400, 'BAD_REQUEST'));
    }

    const results = {
      successCount: 0,
      failCount: 0,
      failures: []
    };

    for (const id of ids) {
      const hq = await resellerhqCrud.getResellerHqById(id);
      if (!hq) {
        results.failCount++;
        results.failures.push({ id, reason: '记录不存在' });
        continue;
      }

      // 检查关联门店
      const storeCount = await resellerhqCrud.countAssociatedStores(hq.hq_apple_id);
      if (storeCount > 0) {
        results.failCount++;
        results.failures.push({ 
          id, 
          name: hq.reseller_name_localized || hq.reseller_name,
          reason: `关联门店 ${storeCount} 条`,
          relatedId: hq.hq_apple_id
        });
        continue;
      }

      // 检查关联学员
      const learnerCount = await resellerhqCrud.countAssociatedLearners(hq.hq_apple_id);
      if (learnerCount > 0) {
        results.failCount++;
        results.failures.push({ 
          id, 
          name: hq.reseller_name_localized || hq.reseller_name,
          reason: `关联学员 ${learnerCount} 条`,
          relatedId: hq.hq_apple_id
        });
        continue;
      }

      // 执行物理删除
      await resellerhqCrud.deleteResellerHq(id);
      results.successCount++;
    }

    res.json(success(results));
  } catch (err) {
    next(err);
  }
}

async function getOptions(req, res, next) {
  try {
    const result = await resellerhqCrud.getFilterOptions();
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
