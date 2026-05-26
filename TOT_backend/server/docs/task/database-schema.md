# Agent 数据源 — MySQL 表结构参考

> 远程 MySQL `ops_forge` 数据库的完整表结构。新增 tool 或修改 SQL 前先查此文档确认字段是否存在。

---

## 组织层级映射

```
learner_account.hq_apple_id           → reseller_headquarter.hq_apple_id  (总部)
learner_account.rtm_level_3_name      → rtm_mapping.rtm_l3_name          (L3渠道)
learner_account.rtm_level_4_name      → rtm_mapping.rtm_l4_name          (L4渠道)
learner_account.reseller_localized_name  (经销商中文名)
learner_account.store_apple_id        → reseller_store.store_apple_id    (门店)
learner_account.sales_name            (销售姓名 = 店员)
```

---

## 核心表字段清单

### `task_publish` — 已发布任务

| 列名 | 类型 | 说明 |
|------|------|------|
| task_publish_id | varchar(64) | 主键 |
| task_title | varchar(255) | 任务标题 |
| task_description | text | 描述 |
| task_type | varchar(32) | single_task / task_bundle |
| platform_scope | varchar(64) | 平台（值不统一：JSON数组 `'["MyPal"]'` 或纯字符串 `'mypal'`） |
| start_date | date | 开始日期 |
| due_date | date | 截止日期 |
| urgency_level | varchar(16) | P0 / P1 / P2 / normal |
| publish_status | varchar(32) | dispatched / ended / draft |

### `learner_account` — 学员档案

| 列名 | 类型 | 说明 |
|------|------|------|
| learner_id | varchar(64) | 主键 |
| email_id | varchar(255) | 邮箱（JOIN 关键字段） |
| store_apple_id | varchar(64) | 门店标识 |
| hq_apple_id | varchar(64) | 总部标识 |
| rtm_level_3_name | varchar(100) | L3 渠道名（可为 NULL） |
| rtm_level_4_name | varchar(100) | L4 渠道名 |
| vad_hq_name | varchar(255) | VAD/HQ 名称（可为 NULL） |
| hq_reseller_localized_name | varchar(255) | 总部中文名（可为 NULL） |
| reseller_localized_name | varchar(255) | 经销商中文名（可为 NULL） |
| sales_name | varchar(100) | 店员姓名（可为 NULL） |
| user_enabled_indicator | tinyint(1) | 是否启用 |

### `task_publish_learner` — 任务学员关联

| 列名 | 类型 | 说明 |
|------|------|------|
| task_publish_learner_id | varchar(64) | 主键 |
| task_publish_id | varchar(64) | FK → task_publish |
| learner_id | varchar(64) | FK → learner_account |

### `learner_task_reminder` — 催办/预警记录

| 列名 | 类型 | 说明 |
|------|------|------|
| reminder_id | varchar(64) | 主键 |
| email_id | varchar(255) | 学员邮箱 |
| task_publish_id | varchar(64) | FK → task_publish |
| reminder_level | varchar(16) | new / P0 / P1 / P2 / P3 |
| reminder_result | varchar(32) | success / received / rejected / platform_limited |
| reminder_at | datetime | 最近催办时间 |

### `mypal_learning_progress_sync` — MyPal 学习进度

| 列名 | 类型 | 说明 |
|------|------|------|
| sync_data_id | varchar(64) | 主键 |
| email_id | varchar(255) | 学员邮箱 |
| product_name | varchar(255) | 产品名称 |
| progress | decimal(5,2) | 完成度 |
| required_flag | tinyint(1) | 是否必学（1=必学） |
| passed_time | datetime | 通过时间（NULL=未通过） |
| passed_week | varchar(32) | 通关周期 |

### `reseller_headquarter` — 经销商总部

| 列名 | 类型 | 说明 |
|------|------|------|
| reseller_hq_id | varchar(64) | 主键 |
| hq_apple_id | varchar(64) | 总部标识 |
| reseller_name_localized | varchar(255) | 经销商中文名 |
| vad_hq_name | varchar(255) | VAD/HQ 名称 |

### `reseller_store` — 门店

| 列名 | 类型 | 说明 |
|------|------|------|
| reseller_store_id | varchar(64) | 主键 |
| store_apple_id | varchar(64) | 门店标识 |
| hq_apple_id | varchar(64) | 所属总部 |
| reseller_name_localized | varchar(255) | 经销商中文名 |
| store_name_localized | varchar(255) | 门店中文名 |

### `rtm_mapping` — RTM 映射

| 列名 | 类型 | 说明 |
|------|------|------|
| rtm_l3_name | varchar(255) | L3 渠道全名 |
| rtm_l3_short_name | varchar(64) | L3 渠道简称 |
| rtm_l4_name | varchar(255) | L4 渠道名 |
