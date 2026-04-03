import { RouteRecordRaw } from 'vue-router';
import { Layout } from '@/router/constant';
import { ProjectOutlined } from '@vicons/antd';
import { renderIcon } from '@/utils/index';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/central/task',
    name: 'CentralTask',
    component: Layout,
    meta: {
      title: '任务管理',
      icon: renderIcon(ProjectOutlined),
      sort: 4,
    },
    children: [
      {
        path: 'publish',
        name: 'CentralTaskPublish',
        meta: {
          title: '任务发布',
          keepAlive: true,
        },
        component: () => import('@/views/central/taskManage/index.vue'),
      },
    ],
  },
];

export default routes;