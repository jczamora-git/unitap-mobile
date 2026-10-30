import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import TabsPage from '@/views/TabsPage.vue';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/tabs/home'
  },
  {
    path: '/tabs/',
    component: TabsPage,
    children: [
      {
        path: '',
        redirect: '/tabs/home'
      },
      {
        path: 'home',
        name: 'Home',
        component: () => import('@/views/HomePage.vue')
      },
      {
        path: 'events',
        name: 'Events',
        component: () => import('@/views/EventsPage.vue')
      },
      {
        path: 'scan',
        name: 'NfcChecker',
        component: () => import('@/views/NfcCheckerPage.vue')
      },
      {
        path: 'students',
        name: 'Students',
        component: () => import('@/views/StudentsPage.vue')
      },
      {
        path: 'finance',
        name: 'Finance',
        component: () => import('@/views/FinancePage.vue')
      }
    ]
  },
  {
    path: '/events/attendance/:occurrenceId?',
    name: 'AttendanceScan',
    component: () => import('@/views/AttendanceScanPage.vue')
  },
  {
    path: '/events/create',
    name: 'CreateEvent',
    component: () => import('@/views/CreateEventPage.vue')
  },
  {
    path: '/events/:id',
    name: 'EventDetail',
    component: () => import('@/views/EventDetailPage.vue')
  },
  {
    path: '/register-student',
    name: 'RegisterStudent',
    component: () => import('@/views/RegisterStudentPage.vue')
  },
  {
    path: '/students/:id',
    name: 'StudentProfile',
    component: () => import('@/views/StudentProfilePage.vue')
  },
  {
    path: '/finance/pay',
    name: 'MakePayment',
    component: () => import('@/views/MakePaymentPage.vue')
  },
  {
    path: '/finance/charges',
    name: 'Charges',
    component: () => import('@/views/ChargesPage.vue')
  },
  {
    path: '/finance/charges/create',
    name: 'CreateCharge',
    component: () => import('@/views/CreateChargePage.vue')
  },
  {
    path: '/finance/wallet/:studentId',
    name: 'StudentWallet',
    component: () => import('@/views/StudentWalletPage.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/SettingsPage.vue')
  },
  {
    path: '/diagnostics/device',
    name: 'DeviceDiagnostics',
    component: () => import('@/views/DevicePage.vue')
  },
  {
    path: '/diagnostics/history',
    name: 'DiagnosticsHistory',
    component: () => import('@/views/HistoryPage.vue')
  },
  {
    path: '/diagnostics/scanner',
    name: 'RawScannerDiagnostics',
    component: () => import('@/views/ScannerPage.vue')
  },
  {
    path: '/:catchAll(.*)',
    redirect: '/tabs/home'
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

export default router;
