'use strict';

const storeCrud = require('../crud/storeCrud');
const resellerhqCrud = require('../crud/resellerhqCrud');

async function getStoreList(o) {
  return await storeCrud.getStoreList(o);
}

async function getStoreById(id) {
  const s = await storeCrud.getStoreById(id);
  if (!s) {
    const e = new Error('门店不存在');
    e.status = 400;
    throw e;
  }
  return s;
}

async function getStoreByAppleId(id) {
  return await storeCrud.getStoreByAppleId(id);
}

async function getStorePage(o) {
  return await storeCrud.getStorePage(o);
}

async function createStore(d) {
  if (!d.store_apple_id || !d.hq_apple_id) {
    const e = new Error('store_apple_id 和 hq_apple_id 为必填字段');
    e.status = 400;
    throw e;
  }

  const exist = await storeCrud.getStoreByAppleId(d.store_apple_id);
  if (exist) {
    const e = new Error('门店 Apple ID 已存在');
    e.status = 400;
    throw e;
  }
  return await storeCrud.createStore(d);
}

async function updateStore(id, d) {
  const s = await storeCrud.getStoreById(id);
  if (!s) {
    const e = new Error('门店不存在');
    e.status = 400;
    throw e;
  }

  return await storeCrud.updateStore(id, d);
}

async function deleteStore(id) {
  const s = await storeCrud.getStoreById(id);
  if (!s) {
    const e = new Error('门店不存在');
    e.status = 400;
    throw e;
  }
  return await storeCrud.deleteStore(id);
}

async function batchDelete(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('未选择任何门店');
    e.status = 400;
    throw e;
  }

  const results = {
    successCount: 0,
    failCount: 0,
    failures: []
  };

  for (const id of ids) {
    const s = await storeCrud.getStoreById(id);
    if (!s) {
      results.failCount++;
      results.failures.push({ id, reason: '记录不存在' });
      continue;
    }

    // 检查关联学员
    const learnerCount = await storeCrud.countAssociatedLearners(s.store_apple_id);
    if (learnerCount > 0) {
      results.failCount++;
      results.failures.push({ 
        id, 
        name: s.store_name_localized || s.store_name,
        reason: `关联学员 ${learnerCount} 条`,
        relatedId: s.store_apple_id
      });
      continue;
    }

    // 执行物理删除
    await storeCrud.deleteStore(id);
    results.successCount++;
  }

  return results;
}

async function batchUploadStore(dataArray) {
  let importedCount = 0;

  for (const row of dataArray) {
    // 1. 智能清理键名：彻底解决 Excel BOM 字符和多余空格干扰
    const cleanRow = {};
    Object.keys(row).forEach(k => {
      const cleanKey = k.trim().replace(/^\uFEFF/, '');
      cleanRow[cleanKey] = row[k];
    });

    const mapped = {
      reseller_store_id: cleanRow['门店 ID'] || cleanRow['门店id'] || cleanRow.reseller_store_id || cleanRow.reseller_id,
      store_apple_id: cleanRow['门店 Apple ID'] || cleanRow['门店Apple ID'] || cleanRow.store_apple_id || null,
      hq_apple_id: cleanRow['经销商信息 Apple ID'] || cleanRow['总部 Apple ID'] || cleanRow['总部Apple ID'] || cleanRow.hq_apple_id || null,
      sub_region_code: cleanRow['子区域编码'] || cleanRow.sub_region_code || null,
      country_region_name: cleanRow['国家/地区'] || cleanRow.country_region_name || null,
      rtm4_name: cleanRow['渠道类型'] || cleanRow.rtm4_name || null,
      contract_id: cleanRow['合同 ID'] || cleanRow['合同ID'] || cleanRow.contract_id || null,
      product_authorization: cleanRow['产品授权'] || cleanRow.product_authorization || null,
      reseller_name: cleanRow['经销商英文名'] || cleanRow.reseller_name || null,
      reseller_name_localized: cleanRow['经销商中文名'] || cleanRow.reseller_name_localized || null,
      store_name: cleanRow['门店英文名'] || cleanRow.store_name || null,
      store_name_localized: cleanRow['门店中文名'] || cleanRow.store_name_localized || null,
      address_line_1: cleanRow['地址行 1'] || cleanRow['地址行1'] || cleanRow.address_line_1 || null,
      address_line_2: cleanRow['地址行 2'] || cleanRow['地址行2'] || cleanRow.address_line_2 || null,
      store_address_line_1: cleanRow['门店地址行 1'] || cleanRow['门店地址行1'] || cleanRow.store_address_line_1 || null,
      store_address_line_2: cleanRow['门店地址行 2'] || cleanRow['门店地址行2'] || cleanRow.store_address_line_2 || null,
      program_name: cleanRow['项目名称'] || cleanRow.program_name || null,
      local_program_name: cleanRow['本地项目名称'] || cleanRow.local_program_name || null,
      city_name: cleanRow['城市'] || cleanRow.city_name || null,
      state_name: cleanRow['省份'] || cleanRow.state_name || null,
      store_city_name: cleanRow['门店城市英文名'] || cleanRow.store_city_name || null,
      actual_opening_date: cleanRow['实际开业日期'] || cleanRow.actual_opening_date || null
    };

    // 必填项：只需保证主键 ID 存在
    if (!mapped.reseller_store_id) continue;

    if (mapped.actual_opening_date) {
      mapped.actual_opening_date = mapped.actual_opening_date.replace(/\//g, '-');
    }

    try {
      // 执行基于主键 ID 的 Upsert
      const existByPk = await storeCrud.getStoreById(mapped.reseller_store_id);
      if (existByPk) {
        await storeCrud.updateStore(mapped.reseller_store_id, mapped);
      } else {
        // 额外保护：针对您数据集中可能出现的 store_apple_id 重复情况
        // 如果 ID 没冲突但业务键冲突了，我们执行基于业务键的更新，防止报错
        if (mapped.store_apple_id) {
          const existByAppleId = await storeCrud.getStoreByAppleId(mapped.store_apple_id);
          if (existByAppleId) {
            await storeCrud.updateStoreByAppleId(mapped.store_apple_id, mapped);
          } else {
            await storeCrud.createStore(mapped);
          }
        } else {
          await storeCrud.createStore(mapped);
        }
      }
      importedCount++;
    } catch (e) {
      console.warn(`[Store Import] 导入行 ${mapped.reseller_store_id} 时出错，已跳过:`, e.message);
    }
  }
  return { importedCount };
}

module.exports = {
  getStoreList,
  getStoreById,
  getStoreByAppleId,
  getStorePage,
  createStore,
  updateStore,
  deleteStore,
  batchDelete,
  batchUploadStore,
};
