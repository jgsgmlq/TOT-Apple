/**
 * 后端 /auth/me 不返回 permissions 列表时，根据 role 生成前端路由过滤所需的权限项。
 * 与 router modules 中 meta.permissions 的 value 对齐。
 */
export function buildPermissionsFromRole(role: string): { label: string; value: string }[] {
  void role;
  return [
    { label: '主控台', value: 'dashboard_console' },
    { label: '工作台', value: 'dashboard_workplace' },
  ];
}
