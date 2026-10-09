import { createRouter, createWebHistory } from 'vue-router'
import ReportListView from '@/views/ReportListView.vue'
import ReportEditView from '@/views/ReportEditView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'list', component: ReportListView },
    { path: '/edit/:id', name: 'edit', component: ReportEditView, props: true },
  ],
})

export default router
