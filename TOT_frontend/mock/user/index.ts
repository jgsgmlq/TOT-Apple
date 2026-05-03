import Mock from 'mockjs';
import { defineMock } from '@alova/mock';

const Random = Mock.Random;

const token = Random.string('upper', 32, 32);

let lastMeUser = {
  userId: '1',
  username: 'central',
  email: '',
  role: 'central' as const,
  storeId: null as string | null,
  employeeId: null as string | null,
  createdAt: new Date().toISOString(),
};

export default defineMock({
  '[POST]/api/v1/auth/login': ({ data }) => {
    const body = (data || {}) as { username?: string; password?: string };
    const u = body.username ?? '';
    const isEmployee = u.includes('@') || u.toLowerCase().includes('employee');
    const role = isEmployee ? 'employee' : 'central';
    lastMeUser = {
      userId: isEmployee ? '2' : '1',
      username: u || 'central',
      email: u.includes('@') ? u : '',
      role,
      storeId: isEmployee ? 'store-1' : null,
      employeeId: isEmployee ? 'emp-1' : null,
      createdAt: new Date().toISOString(),
    };
    return {
      code: 200,
      message: 'success',
      data: {
        token,
        userInfo: {
          userId: lastMeUser.userId,
          username: lastMeUser.username,
          email: lastMeUser.email,
          role,
          storeId: lastMeUser.storeId,
          employeeId: lastMeUser.employeeId,
        },
      },
      requestId: 'mock-req-login',
    };
  },
  '[GET]/api/v1/auth/me': () => ({
    code: 200,
    message: 'success',
    data: lastMeUser,
    requestId: 'mock-req-me',
  }),
});
