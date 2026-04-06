import { defineStore } from 'pinia';
import { store } from '@/store';
import { ACCESS_TOKEN, CURRENT_USER, IS_SCREENLOCKED } from '@/store/mutation-types';
import { HQ_ENTRY_KEY } from '@/constants/entry';
import { ResultEnum } from '@/enums/httpEnum';

import { getUserInfo as getUserInfoApi, login as loginApi } from '@/api/system/user';
import { storage } from '@/utils/Storage';
import { buildPermissionsFromRole } from '@/utils/auth/permissions';

export type UserInfoType = {
  username: string;
  email: string;
  userId?: string;
  role?: string;
  storeId?: string | null;
  employeeId?: string | null;
  createdAt?: string;
  /** 登录身份：hq 总部 | manager 店长 | staff 店员 */
  identityType?: string;
  identityLabel?: string;
};

export interface IUserState {
  token: string;
  username: string;
  welcome: string;
  avatar: string;
  permissions: any[];
  info: UserInfoType;
}

export const useUserStore = defineStore({
  id: 'app-user',
  state: (): IUserState => ({
    token: storage.get(ACCESS_TOKEN, ''),
    username: '',
    welcome: '',
    avatar: '',
    permissions: [],
    info: storage.get(CURRENT_USER, {}),
  }),
  getters: {
    getToken(): string {
      return this.token;
    },
    getAvatar(): string {
      return this.avatar;
    },
    getNickname(): string {
      return this.username;
    },
    getPermissions(): [any][] {
      return this.permissions;
    },
    getUserInfo(): UserInfoType {
      return this.info;
    },
  },
  actions: {
    setToken(token: string) {
      this.token = token;
    },
    setAvatar(avatar: string) {
      this.avatar = avatar;
    },
    setPermissions(permissions) {
      this.permissions = permissions;
    },
    setUserInfo(info: UserInfoType) {
      this.info = info;
    },
    // 登录（ToT API：POST /api/v1/auth/login，响应 data.token / data.userInfo）
    async login(params: any) {
      const { username, password, email: emailParam } = params;

      // 前端表单当前只有邮箱输入框，为了不改动过多 UI，我们依然将密码在发给后端前设为默认初始密码
      const realPassword = password === 'dummy_password' ? 'Train2026!' : password;

      try {
        const response = await loginApi({ username: username, password: realPassword }).send();
        const { code, message } = response;
        const payload = (response as any).data ?? (response as any).result;

        if (code === ResultEnum.SUCCESS && payload?.token) {
          const ex = 7 * 24 * 60 * 60;
          const { token, userInfo } = payload;
          sessionStorage.removeItem(HQ_ENTRY_KEY);
          storage.set(ACCESS_TOKEN, token, ex);
          const merged: UserInfoType = {
            username: userInfo?.username ?? username,
            email: userInfo?.email ?? emailParam ?? (username?.includes('@') ? username : ''),
            userId: userInfo?.userId,
            role: userInfo?.role,
            storeId: userInfo?.storeId ?? null,
            employeeId: userInfo?.employeeId ?? null,
          };
          storage.set(CURRENT_USER, merged, ex);
          storage.set(IS_SCREENLOCKED, false);
          this.setToken(token);
          this.setUserInfo(merged);
          return { code: ResultEnum.SUCCESS, data: payload, message: '登录成功' };
        } else {
          return { code, message: message || '登录失败' };
        }
      } catch (error: any) {
        return { code: ResultEnum.ERROR, message: error.message || '未查询到该店员信息，登录失败' };
      }
    },

    // 获取用户信息（ToT API：GET /api/v1/auth/me）
    async getInfo() {
      // === 模拟前端假数据信息获取（测试用） ===
      if (this.token && this.token.startsWith('mock-token-')) {
        const username = this.token.replace('mock-token-', '');
        const mockUser = {
          userId: 'mock-id-' + username,
          username: username === 'test1@tot.com' ? '测试店员1' : '测试店员2',
          role: 'employee',
          storeId: 'store-mock-01',
          employeeId: 'emp-mock-01',
          email: username,
        };
        const permissionsList = buildPermissionsFromRole(mockUser.role);
        this.setPermissions(permissionsList);
        const prev = this.info || ({} as UserInfoType);
        this.setUserInfo({ ...prev, ...mockUser });
        this.setAvatar('');
        return mockUser;
      }
      // === 模拟结束 ===

      const userRes = await getUserInfoApi().send();
      // 在 alova/index.ts 中配置了 responds.onSuccess，如果成功直接返回 payload
      // 但某些接口可能包裹在 data 里，视实际情况而定。目前 axios/alova 的处理是直接拿到 payload
      const user = userRes as {
        userId: string;
        username: string;
        role: string;
        storeId: string | null;
        employeeId: string | null;
        createdAt?: string;
        email?: string;
      };

      if (!user?.role) {
        throw new Error('getInfo: invalid user payload');
      }
      const permissionsList = buildPermissionsFromRole(user.role);
      this.setPermissions(permissionsList);
      const prev = this.info || ({} as UserInfoType);
      this.setUserInfo({
        ...prev,
        username: user.username,
        email: (user as { email?: string }).email ?? prev.email ?? '',
        userId: user.userId,
        role: user.role,
        storeId: user.storeId,
        employeeId: user.employeeId,
        createdAt: user.createdAt,
      });
      this.setAvatar('');
      return user;
    },

    // 登出
    async logout() {
      sessionStorage.removeItem(HQ_ENTRY_KEY);
      this.setPermissions([]);
      this.setUserInfo({ username: '', email: '' });
      storage.remove(ACCESS_TOKEN);
      storage.remove(CURRENT_USER);
    },
  },
});

// Need to be used outside the setup
export function useUser() {
  return useUserStore(store);
}
