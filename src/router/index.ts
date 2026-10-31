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
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginPage.vue')
  },
  {
    path: '/academic',
    name: 'Academic',
    component: () => import('@/views/AcademicPage.vue')
  },
  {
    path: '/students/import',
    name: 'CsvImport',
    component: () => import('@/views/CsvImportPage.vue')
  },
  {
    path: '/finance/reports',
    name: 'Reports',
    component: () => import('@/views/ReportsPage.vue')
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/RegisterPage.vue')
  },
  {
    path: '/initial-sync',
    name: 'InitialSync',
    component: () => import('@/views/InitialSyncPage.vue')
  },
  {
    path: '/sync-status',
    name: 'SyncStatus',
    component: () => import('@/views/SyncStatusPage.vue')
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

// UniTap 2.0 Auth Navigation Guard
router.beforeEach(async (to, _from, next) => {
  const { authService } = await import('@/services/auth.service');
  const { SupabaseAuthService } = await import('@/integrations/supabase/auth.service');
  await authService.initSession();
  await SupabaseAuthService.initialize();

  const isPublic = to.path === '/login' || to.path === '/register';
  const authenticated = SupabaseAuthService.isAuthenticated.value || authService.isAuthenticated.value;

  if (!authenticated && !isPublic) {
    // If not authenticated, redirect to login
    next('/login');
  } else if (authenticated && (to.path === '/login' || to.path === '/register')) {
    // If already logged in and visiting public auth, go to initial-sync or home
    next('/tabs/home');
  } else {
    next();
  }
});

export default router;
