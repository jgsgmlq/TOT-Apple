import { App } from 'vue';
import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from 'vue-router';
import { RedirectRoute } from '@/router/base';
import { PageEnum } from '@/enums/pageEnum';
import { createRouterGuards } from './guards';
import type { IModuleType } from './types';

/** 首页带 query 时进入总部（兼容仅对 / 做 SPA 回退的静态服务器，/hq 可能 404） */
function rootRedirect(to: RouteLocationNormalized) {
  const q = to.query;
  if (q.entry === 'hq' || q.hq === '1' || q.hq === 'true') {
    return { path: '/hq', replace: true };
  }
  // 默认根路径跳去店员登录端
  return { path: '/employee/login', replace: true };
}

const modules = import.meta.glob<IModuleType>('./modules/**/*.ts', { eager: true });

const routeModuleList: RouteRecordRaw[] = Object.keys(modules).reduce((list, key) => {
  const mod = modules[key].default ?? {};
  const modList = Array.isArray(mod) ? [...mod] : [mod];
  return [...list, ...modList];
}, []);

function sortRoute(a, b) {
  return (a.meta?.sort ?? 0) - (b.meta?.sort ?? 0);
}

routeModuleList.sort(sortRoute);

export const RootRoute: RouteRecordRaw = {
  path: '/',
  name: 'Root',
  redirect: rootRedirect,
  meta: {
    title: 'Root',
  },
};

export const HqEntryRoute: RouteRecordRaw = {
  path: '/hq',
  name: 'HqEntry',
  component: () => import('@/views/hq/entry.vue'),
  meta: {
    title: '正在进入总部…',
    ignoreAuth: true,
  },
};

/** strict 模式下 /hq/ 单独重定向到 /hq */
export const HqEntrySlashRedirect: RouteRecordRaw = {
  path: '/hq/',
  redirect: '/hq',
};

export const EmployeeLoginRoute: RouteRecordRaw = {
  path: '/employee/login',
  name: 'EmployeeLogin',
  component: () => import('@/views/employee/login.vue'),
  meta: {
    title: '店员登录',
    ignoreAuth: true,
  },
};

export const ExecutiveHomeRoute: RouteRecordRaw = {
  path: '/executive',
  name: 'ExecutiveHome',
  component: () => import('@/views/executive/index.vue'),
  meta: {
    title: 'Executive Chat',
  },
};

export const ExecutiveLoginRoute: RouteRecordRaw = {
  path: '/executive/login',
  name: 'ExecutiveLogin',
  component: () => import('@/views/executive/login.vue'),
  meta: {
    title: 'Executive Chat',
    ignoreAuth: true,
  },
};

export const EmployeeHomeRoute: RouteRecordRaw = {
  path: '/employee',
  name: 'EmployeeHome',
  component: () => import('@/views/employee/index.vue'),
  meta: {
    title: '店员工作台',
  },
};

/** 旧书签 /login 跳转到店员登录 */
export const LoginRedirectRoute: RouteRecordRaw = {
  path: '/login',
  redirect: '/employee/login',
};

//需要验证权限
export const asyncRoutes = [...routeModuleList];

//普通路由 无需验证权限
export const constantRouter: RouteRecordRaw[] = [
  HqEntryRoute,
  HqEntrySlashRedirect,
  EmployeeLoginRoute,
  ExecutiveLoginRoute,
  ExecutiveHomeRoute,
  EmployeeHomeRoute,
  LoginRedirectRoute,
  RootRoute,
  RedirectRoute,
];

const router = createRouter({
  history: createWebHistory(),
  routes: constantRouter,
  strict: true,
  scrollBehavior: () => ({ left: 0, top: 0 }),
});

export function setupRouter(app: App) {
  app.use(router);
  // 创建路由守卫
  createRouterGuards(router);
}

export default router;
