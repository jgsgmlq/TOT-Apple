import { RouteRecordRaw } from 'vue-router';
import { Layout } from '@/router/constant';
import { DashboardOutlined } from '@vicons/antd';
import { renderIcon } from '@/utils/index';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/central',
    name: 'central',
    redirect: '/central/board',
    component: Layout,
    meta: {
      title: '总部管理',
      icon: renderIcon(DashboardOutlined),
      sort: 3,
    },
    children: [
      {
        path: 'board',
        name: 'central_board',
        meta: {
          title: '实时看板',
          keepAlive: true,
        },
        component: () => import('@/views/central/newBoard/index.vue'),
      },
    ],
  },
];

export default routes;
