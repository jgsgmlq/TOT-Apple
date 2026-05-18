'use strict';

const flattenEntitiesForRepair = (entities) => {
  const out = {};
  for (const [k, v] of Object.entries(entities || {})) {
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      if (v.canonical !== undefined && v.canonical !== null && v.canonical !== '') {
        out[k] = v.canonical;
      } else if (v.raw !== undefined && v.raw !== null && v.raw !== '') {
        out[k] = v.raw;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
};

module.exports = { flattenEntitiesForRepair };
