/**
 * 与后端 `TOT_backend/server/services/autoNudge.js` 中解析的 `auto_nudge_rules` 结构对齐。
 * 同时兼容旧版前端写入的扁平字段名。
 */

export type AlertRulesForm = {
  laggingLifestyle: number;
  laggingMono: number;
  startDelayPercent: number;
  deadlineCrisisHours: number;
  deadlineCrisisHoursSecondary: number;
};

/** 后端 evaluateAndTriggerAutoNudges 使用的结构 */
export type AutoNudgeRulesApi = {
  progressLag?: { lifestyle?: number; mono?: number };
  startDelay?: number;
  deadlineCrisis?: { p0?: number; p1?: number };
};

/** 旧版前端曾写入的扁平结构 */
type LegacyFlat = {
  laggingLifestyle?: number;
  laggingMono?: number;
  startDelayPercent?: number;
  deadlineCrisisHours?: number;
  deadlineCrisisHoursSecondary?: number;
};

const DEFAULT_FORM: AlertRulesForm = {
  laggingLifestyle: 3,
  laggingMono: 1,
  startDelayPercent: 50,
  deadlineCrisisHours: 24,
  deadlineCrisisHoursSecondary: 48,
};

type StoredRules = (AutoNudgeRulesApi & LegacyFlat) | null | undefined;

/**
 * 从 API / DB 读出的规则 → 表单展示用（兼容嵌套 + 扁平）
 */
export function formFromAutoNudgeRules(r: StoredRules): AlertRulesForm {
  if (!r || typeof r !== 'object') return { ...DEFAULT_FORM };
  return {
    laggingLifestyle: r.progressLag?.lifestyle ?? r.laggingLifestyle ?? DEFAULT_FORM.laggingLifestyle,
    laggingMono: r.progressLag?.mono ?? r.laggingMono ?? DEFAULT_FORM.laggingMono,
    startDelayPercent: r.startDelay ?? r.startDelayPercent ?? DEFAULT_FORM.startDelayPercent,
    deadlineCrisisHours: r.deadlineCrisis?.p0 ?? r.deadlineCrisisHours ?? DEFAULT_FORM.deadlineCrisisHours,
    deadlineCrisisHoursSecondary:
      r.deadlineCrisis?.p1 ?? r.deadlineCrisisHoursSecondary ?? DEFAULT_FORM.deadlineCrisisHoursSecondary,
  };
}

/**
 * 表单 → POST/PATCH 写入后端的结构（与 autoNudge.js 一致）
 */
export function toApiAutoNudgeRules(form: AlertRulesForm): AutoNudgeRulesApi {
  return {
    progressLag: { lifestyle: form.laggingLifestyle, mono: form.laggingMono },
    startDelay: form.startDelayPercent,
    deadlineCrisis: { p0: form.deadlineCrisisHours, p1: form.deadlineCrisisHoursSecondary },
  };
}

/** 总部看板等处的扁平展示（与表单字段同名，便于模板） */
export function displayAutoNudgeRules(r: StoredRules): AlertRulesForm {
  return formFromAutoNudgeRules(r);
}

/**
 * 是否配置了预警规则（用于「未配置」空态）
 */
export function hasAutoNudgeRulesConfigured(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  if (o.progressLag && typeof o.progressLag === 'object') return true;
  if (typeof o.startDelay === 'number') return true;
  if (o.deadlineCrisis && typeof o.deadlineCrisis === 'object') return true;
  if (
    'laggingLifestyle' in o ||
    'laggingMono' in o ||
    'startDelayPercent' in o ||
    'deadlineCrisisHours' in o ||
    'deadlineCrisisHoursSecondary' in o
  ) {
    return true;
  }
  return false;
}
