import Vue from 'vue'
import Router from 'vue-router'

/* 模拟 Vue2 + Vue Router 3 的路由配置，用于自测 routes 命令 */
export default new Router({
  routes: [
    {
      path: '/event/list',
      name: 'EventList',
      component: () => import('@/views/event/list'),
      meta: { title: '事件列表' }
    },
    {
      path: '/event/detail/:id',
      name: 'EventDetail',
      component: () => import('@/views/event/detail'),
      meta: { title: '事件详情' }
    },
    {
      path: '/event/stat',
      name: 'EventStat',
      component: () => import('@/views/event/stat'),
      meta: { title: '事件统计' }
    },
    {
      path: '/overview',
      name: 'Overview',
      component: () => import('@/views/overview/index'),
      meta: { title: '运行总览' }
    },
    {
      path: '/system/user',
      name: 'SystemUser',
      component: () => import('@/views/system/user'),
      meta: { title: '用户管理' }
    }
  ]
})
