'use strict';

var E = module.exports = {};

E.AUTH_001 = { code: 401, message: '未提供认证 Token' };
E.AUTH_002 = { code: 401, message: 'Token 无效或已过期' };
E.AUTH_003 = { code: 403, message: '权限不足' };

E.TASK_001 = { code: 400, message: '任务标题不能为空' };
E.TASK_002 = { code: 400, message: '任务周次格式无效' };
E.TASK_100 = { code: 400, message: '任务不存在' };
E.TASK_101 = { code: 400, message: '已下发的任务只能修改截止时间' };
E.TASK_200 = { code: 500, message: '任务创建失败' };

E.DASH_100 = { code: 400, message: '看板指标计算失败' };
E.DASH_101 = { code: 400, message: '查询周次参数无效' };

E.ADMIN_001 = { code: 400, message: '账户名已存在' };
E.ADMIN_100 = { code: 400, message: '账户不存在' };
E.ADMIN_101 = { code: 400, message: '密码错误' };

E.MYPAL_001 = { code: 400, message: '同步参数缺失' };
E.MYPAL_100 = { code: 502, message: 'MyPal 接口调用失败' };

E.CHAT_001 = { code: 400, message: '会话 ID 无效' };
E.CHAT_002 = { code: 400, message: '消息内容为空' };
E.CHAT_003 = { code: 404, message: '会话不存在或已过期' };
