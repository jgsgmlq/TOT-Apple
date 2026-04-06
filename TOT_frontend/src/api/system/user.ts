import { Alova } from '@/utils/http/alova/index';

/**
 * @description: 获取当前登录用户（ToT API: GET /api/v1/auth/me）
 */
export function getUserInfo() {
  return Alova.Get<InResult>('/auth/me');
}

export type LoginBody = {
  username: string;
  password: string;
};

/**
 * @description: 用户登录（ToT API: POST /api/v1/auth/login）
 */
export function login(params: LoginBody) {
  return Alova.Post<InResult>('/auth/login', params, {
    meta: {
      isReturnNativeResponse: true,
      ignoreToken: true,
    },
  });
}

/**
 * @description: 用户修改密码
 */
export function changePassword(params, uid) {
  return Alova.Post(`/user/u${uid}/changepw`, { params });
}

/**
 * @description: 用户登出
 */
export function logout(params) {
  return Alova.Post('/login/logout', {
    params,
  });
}
