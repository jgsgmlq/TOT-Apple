import { PageEnum } from '@/enums/pageEnum';
import { ErrorPageRoute } from '@/router/base';
import { useAsyncRoute } from '@/store/modules/asyncRoute';
import { useUser, type UserInfoType } from '@/store/modules/user';
import { ACCESS_TOKEN, CURRENT_USER } from '@/store/mutation-types';
import { HQ_ENTRY_KEY } from '@/constants/entry';
import { buildPermissionsFromRole } from '@/utils/auth/permissions';
import { storage } from '@/utils/Storage';
import type { RouteRecordRaw } from 'vue-router';
import { isNavigationFailure, Router } from 'vue-router';
import { RedirectName } from './constant';
import { login } from '@/api/system/user';
import { ResultEnum } from '@/enums/httpEnum';

const LOGIN_PATH = PageEnum.BASE_LOGIN;

const whitePathList = [LOGIN_PATH]; // no redirect whitelist

/** 静默登录成功才注册动态路由；失败返回 false，避免无 token 进入 /central 后 401 与 /hq 死循环 */
async function bootstrapHqSession(
  router: Router,
  asyncRouteStore: ReturnType<typeof useAsyncRoute>,
  userStore: ReturnType<typeof useUser>
): Promise<boolean> {
  try {
    const res = (await login({ username: 'central', password: 'Train2026!' }).send()) as {
      code?: number;
      message?: string;
      data?: { token?: string; userInfo?: UserInfoType };
      result?: { token?: string; userInfo?: UserInfoType };
    };
    if (res.code !== undefined && res.code !== ResultEnum.SUCCESS && res.code !== 201) {
      console.error('总部静默登录失败：', res.message || res.code);
      return false;
    }
    const payload = res?.data ?? res?.result;
    const token = payload?.token;
    const userInfo = payload?.userInfo;
    if (!token || !userInfo) {
      console.error('总部静默登录失败：未返回 token 或 userInfo');
      return false;
    }

    storage.set(ACCESS_TOKEN, token, 7 * 24 * 60 * 60);
    storage.set(CURRENT_USER, userInfo, 7 * 24 * 60 * 60);
    userStore.setToken(token);
    userStore.setUserInfo(userInfo);

    const role = userInfo.role || 'central';
    const permissions = buildPermissionsFromRole(role);
    userStore.setPermissions(permissions);

    const routeUser = { ...userInfo, permissions };
    const routes = await asyncRouteStore.generateRoutes(routeUser);
    routes.forEach((item) => {
      router.addRoute(item as unknown as RouteRecordRaw);
    });
    const isErrorPage = router.getRoutes().findIndex((item) => item.name === ErrorPageRoute.name);
    if (isErrorPage === -1) {
      router.addRoute(ErrorPageRoute as unknown as RouteRecordRaw);
    }
    asyncRouteStore.setDynamicRouteAdded(true);
    return true;
  } catch (err) {
    console.error('总部访客静默登录失败:', err);
    return false;
  }
}

export function createRouterGuards(router: Router) {
  const userStore = useUser();
  const asyncRouteStore = useAsyncRoute();
  router.beforeEach(async (to, from, next) => {
    storage.setPrefixFromPath(to.path);
    // 跨应用导航时（例如从 /hq 切到 /employee），确保存储前缀切换后，Pinia 状态能同步最新缓存的数据
    userStore.setToken(storage.get(ACCESS_TOKEN) || '');
    userStore.setUserInfo(storage.get(CURRENT_USER) || {});

    const Loading = window['$loading'] || null;
    Loading && Loading.start();
    if (from.path === LOGIN_PATH && to.name === 'errorPage') {
      next(PageEnum.BASE_HOME);
      return;
    }

    // Whitelist can be directly entered
    if (whitePathList.includes(to.path as PageEnum)) {
      next();
      return;
    }

    const token = storage.get(ACCESS_TOKEN);

    // ------------------------------------------
    // 核心拦截区 0: 总部入口识别与清理
    // ------------------------------------------
    const isHqQuery = to.query.entry === 'hq' || to.query.hq === '1' || to.query.hq === 'true';

    const hqErr = to.query.hqError;
    const isHqErrorPage =
      hqErr === 'login' || hqErr === '1' || hqErr === 'true' || String(hqErr || '') === 'session';

    // 静默登录失败后的停留页：勿再清空/重定向，否则会与 /central/board ↔ /hq 循环
    if ((to.path === '/hq' || to.path === '/hq/') && isHqErrorPage) {
      next();
      return;
    }

    // 如果是通过特权入口进入：先静默登录成功再进中央面板，失败则留在 /hq?hqError=login
    if (
      (isHqQuery && !to.path.startsWith('/employee') && !to.path.startsWith('/executive')) ||
      to.path === '/hq' ||
      to.path === '/hq/'
    ) {
      sessionStorage.setItem(HQ_ENTRY_KEY, '1');

      const token = storage.get(ACCESS_TOKEN);
      const isCentralSession =
        asyncRouteStore.getIsDynamicRouteAdded &&
        !!token &&
        userStore.getUserInfo?.role === 'central';

      if (!isCentralSession) {
        storage.clear();
        userStore.setToken('');
        sessionStorage.setItem(HQ_ENTRY_KEY, '1');

        const ok = await bootstrapHqSession(router, asyncRouteStore, userStore);
        if (!ok) {
          next({ path: '/hq', replace: true, query: { hqError: 'login' } });
          return;
        }
      }

      if (to.path === '/central/board') {
        next();
        return;
      }

      next({ path: '/central/board', replace: true });
      return;
    }

    // 如果用户主动访问店员端，清除总部标记，避免冲突
    if (to.path.startsWith('/employee') || to.path.startsWith('/executive')) {
      sessionStorage.removeItem(HQ_ENTRY_KEY);
    }

    // ------------------------------------------
    // 核心拦截区 1: 是否已标记为总部会话
    // 如果已经带有 HQ 标记，跳过所有的店员 token 和 login 检查
    // ------------------------------------------
    if (
      sessionStorage.getItem(HQ_ENTRY_KEY) === '1' &&
      !to.path.startsWith('/employee') &&
      !to.path.startsWith('/executive')
    ) {
      if (!asyncRouteStore.getIsDynamicRouteAdded) {
        const ok = await bootstrapHqSession(router, asyncRouteStore, userStore);
        if (!ok) {
          next({ path: '/hq', replace: true, query: { hqError: 'login' } });
          return;
        }
        // 动态 addRoute 后必须重放当前导航，否则仍按「无匹配路由」解析，页面空白
        next({ ...to, replace: true });
        return;
      }
      next();
      return;
    }

    // ------------------------------------------
    // 核心拦截区 2: 店员端逻辑
    // ------------------------------------------
    if (to.path === '/employee/login') {
      if (token) {
        if (!userStore.info.role) {
          try {
            await userStore.getInfo();
          } catch {
            storage.clear();
            next();
            return;
          }
        }
        if (userStore.info.role === 'employee') {
          next('/employee');
          return;
        }
        // 如果带了非店员的token来访问店员登录页，清空并留在店员登录页
        storage.clear();
        userStore.setToken('');
        next();
        return;
      }
      next();
      return;
    }

    if (to.path.startsWith('/employee') && to.path !== '/employee/login') {
      if (!token) {
        next({ path: '/employee/login', query: { redirect: to.fullPath } });
        return;
      }
      if (!userStore.info.role) {
        try {
          await userStore.getInfo();
        } catch {
          storage.clear();
          next({ path: '/employee/login', query: { redirect: to.fullPath } });
          return;
        }
      }
      if (userStore.info.role !== 'employee') {
        // 如果总部的人强行访问 /employee，清除他的总部 token，让他重新登录店员账号
        storage.clear();
        userStore.setToken('');
        next({ path: '/employee/login', replace: true });
        return;
      }
      next();
      return;
    }

    // ------------------------------------------

    // ------------------------------------------
    // 核心拦截区 3: 主管端逻辑
    // ------------------------------------------
    if (to.path === '/executive/login') {
      if (token) {
        if (!userStore.info.role) {
          try {
            await userStore.getInfo();
          } catch {
            storage.clear();
            next();
            return;
          }
        }
        if (userStore.info.role === 'executive') {
          next('/executive');
          return;
        }
        storage.clear();
        userStore.setToken('');
        next();
        return;
      }
      next();
      return;
    }

    if (to.path.startsWith('/executive') && to.path !== '/executive/login') {
      if (!token) {
        next({ path: '/executive/login', query: { redirect: to.fullPath } });
        return;
      }
      if (!userStore.info.role) {
        try {
          await userStore.getInfo();
        } catch {
          storage.clear();
          next({ path: '/executive/login', query: { redirect: to.fullPath } });
          return;
        }
      }
      if (userStore.info.role !== 'executive') {
        storage.clear();
        userStore.setToken('');
        next({ path: '/executive/login', replace: true });
        return;
      }
      next();
      return;
    }

    // ------------------------------------------
    // 全局未登录拦截兜底
    // ------------------------------------------
    if (!token) {
      if (to.meta.ignoreAuth) {
        next();
        return;
      }

      // 对于访问中央管理端的请求，如果没有 token（且没有 HQ_ENTRY_KEY，因为前面已经处理了），
      // 为了安全，应该引导至总部登录（当前项目总部入口即为 /hq 自动静默，所以跳 /hq 重新跑静默登录流程）
      if (to.path.startsWith('/central')) {
        next({ path: '/hq', replace: true });
        return;
      }

      if (to.path.startsWith('/executive')) {
        next({
          path: '/executive/login',
          replace: true,
          query: to.fullPath ? { redirect: to.fullPath } : undefined,
        });
        return;
      }

      next({
        path: '/employee/login',
        replace: true,
        query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : undefined,
      });
      return;
    }

    // ------------------------------------------
    // 全局兜底
    // ------------------------------------------
    if (userStore.info.role === 'employee' && !to.path.startsWith('/employee')) {
      // 员工试图越权访问非员工页面
      next('/employee');
      return;
    }

    if (userStore.info.role === 'executive' && !to.path.startsWith('/executive')) {
      next('/executive');
      return;
    }

    if (asyncRouteStore.getIsDynamicRouteAdded) {
      next();
      return;
    }

    let userInfo;
    try {
      userInfo = await userStore.getInfo();
    } catch {
      storage.clear();
      let targetPath = '/employee/login';
      if (to.path.startsWith('/central')) targetPath = '/hq';
      else if (to.path.startsWith('/executive')) targetPath = '/executive/login';

      next({
        path: targetPath,
        replace: true,
        query: to.path ? { redirect: to.fullPath } : undefined,
      });
      return;
    }

    const routes = await asyncRouteStore.generateRoutes(userInfo);

    // 动态添加可访问路由表
    routes.forEach((item) => {
      router.addRoute(item as unknown as RouteRecordRaw);
    });

    //添加404
    const isErrorPage = router.getRoutes().findIndex((item) => item.name === ErrorPageRoute.name);
    if (isErrorPage === -1) {
      router.addRoute(ErrorPageRoute as unknown as RouteRecordRaw);
    }

    const redirectPath = (from.query.redirect || to.path) as string;
    const redirect = decodeURIComponent(redirectPath);
    const nextData = to.path === redirect ? { ...to, replace: true } : { path: redirect };
    asyncRouteStore.setDynamicRouteAdded(true);
    next(nextData);
    Loading && Loading.finish();
  });

  router.afterEach((to, _, failure) => {
    document.title = (to?.meta?.title as string) || document.title;
    if (isNavigationFailure(failure)) {
      //console.log('failed navigation', failure)
    }
    const asyncRouteStore = useAsyncRoute();
    // 在这里设置需要缓存的组件名称
    const keepAliveComponents = asyncRouteStore.keepAliveComponents;
    const currentComName: any = to.matched.find((item) => item.name == to.name)?.name;
    if (currentComName && !keepAliveComponents.includes(currentComName) && to.meta?.keepAlive) {
      // 需要缓存的组件
      keepAliveComponents.push(currentComName);
    } else if (!to.meta?.keepAlive || to.name == RedirectName) {
      // 不需要缓存的组件
      const index = asyncRouteStore.keepAliveComponents.findIndex((name) => name == currentComName);
      if (index != -1) {
        keepAliveComponents.splice(index, 1);
      }
    }
    asyncRouteStore.setKeepAliveComponents(keepAliveComponents);
    const Loading = window['$loading'] || null;
    Loading && Loading.finish();
  });

  router.onError((error) => {
    console.log(error, '路由错误');
  });
}
