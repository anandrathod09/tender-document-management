import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { PERMISSIONS, type Permission } from '@tdm/shared/permissions'
import { PRODUCT_NAME } from '@/config'
import { useAuthStore } from '@/stores/auth'
import type { Workspace } from '@/stores/workspace'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** Signed-in users only. */
    auth?: boolean
    /** Signed-out users only (sign-in, accept invitation). */
    guest?: boolean
    permission?: Permission
  }
}

const AdminLayout = () => import('@/layouts/AdminLayout.vue')
const AuthLayout = () => import('@/layouts/AuthLayout.vue')
const MessagePage = () => import('@/features/system/MessagePage.vue')
const SignInPage = () => import('@/features/auth/SignInPage.vue')

const notFoundRoute: RouteRecordRaw = {
  path: '/:pathMatch(.*)*',
  component: MessagePage,
  props: {
    title: 'Page not found',
    message: 'The page you are looking for does not exist.',
    showHomeLink: true,
  },
  meta: { title: 'Not found' },
}

/** A signed-out page shown inside the split-screen sign-in layout. */
function guestPage(path: string, page: RouteRecordRaw['component'], title: string): RouteRecordRaw {
  return {
    path,
    component: AuthLayout,
    children: [{ path: '', component: page!, meta: { guest: true, title } }],
  }
}

function tenantRoutes(): RouteRecordRaw[] {
  return [
    guestPage('/signin', SignInPage, 'Sign in'),
    guestPage(
      '/accept-invite',
      () => import('@/features/auth/AcceptInvitePage.vue'),
      'Set your password',
    ),
    ...passwordPages(),
    // Public: customers check warranty and raise service requests (when turned on in Settings).
    {
      path: '/support',
      component: () => import('@/features/support/SupportPage.vue'),
      meta: { title: 'Product Support' },
    },
    {
      path: '/',
      component: AdminLayout,
      meta: { auth: true },
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          component: () => import('@/features/dashboard/DashboardPage.vue'),
          meta: { title: 'Dashboard' },
        },
        {
          path: 'tenders',
          component: () => import('@/features/tenders/TenderListPage.vue'),
          meta: { title: 'Tenders' },
        },
        {
          path: 'tenders/import',
          component: () => import('@/features/tenders/ImportPage.vue'),
          meta: { title: 'Import from Excel', permission: PERMISSIONS.TENDER_IMPORT },
        },
        {
          path: 'tenders/:id',
          component: () => import('@/features/tenders/TenderDetailPage.vue'),
          meta: { title: 'Tender' },
        },
        {
          path: 'users',
          component: () => import('@/features/users/UsersPage.vue'),
          meta: { title: 'Users', permission: PERMISSIONS.USER_MANAGE },
        },
        {
          path: 'settings/stages',
          component: () => import('@/features/settings/StageSettingsPage.vue'),
          meta: { title: 'Workflow stages', permission: PERMISSIONS.WORKFLOW_MANAGE },
        },
        {
          path: 'settings/general',
          component: () => import('@/features/settings/WorkspaceSettingsPage.vue'),
          meta: { title: 'Settings', permission: PERMISSIONS.SETTINGS_MANAGE },
        },
        {
          path: 'settings/companies',
          component: () => import('@/features/companies/CompaniesPage.vue'),
          meta: { title: 'Bidding companies', permission: PERMISSIONS.COMPANY_MANAGE },
        },
        {
          path: 'tenders/:id/installation',
          component: () => import('@/features/installation/InstallationPage.vue'),
          meta: { title: 'Installation report' },
        },
        {
          path: 'assets',
          component: () => import('@/features/assets/AssetsPage.vue'),
          meta: { title: 'Installed assets', permission: PERMISSIONS.ASSET_VIEW },
        },
        {
          path: 'tickets',
          component: () => import('@/features/tickets/TicketsPage.vue'),
          meta: { title: 'Service tickets', permission: PERMISSIONS.TICKET_MANAGE },
        },
        {
          path: 'tickets/:id',
          component: () => import('@/features/tickets/TicketDetailPage.vue'),
          meta: { title: 'Ticket', permission: PERMISSIONS.TICKET_MANAGE },
        },
        {
          path: 'reports',
          component: () => import('@/features/reports/ReportsPage.vue'),
          meta: { title: 'Reports', permission: PERMISSIONS.REPORT_VIEW },
        },
        {
          path: 'library',
          component: () => import('@/features/library/LibraryPage.vue'),
          meta: { title: 'Document library' },
        },
        {
          path: 'account/security',
          component: () => import('@/features/account/SecurityPage.vue'),
          meta: { title: 'My Security' },
        },
        {
          path: 'settings/letters',
          component: () => import('@/features/letters/LettersPage.vue'),
          meta: { title: 'Letter templates', permission: PERMISSIONS.COMPANY_MANAGE },
        },
        {
          path: 'settings/letters/new',
          component: () => import('@/features/letters/LetterEditorPage.vue'),
          meta: { title: 'New letter', permission: PERMISSIONS.COMPANY_MANAGE },
        },
        {
          path: 'settings/letters/:id',
          component: () => import('@/features/letters/LetterEditorPage.vue'),
          meta: { title: 'Edit letter', permission: PERMISSIONS.COMPANY_MANAGE },
        },
        {
          path: 'billing',
          component: () => import('@/features/billing/BillingPage.vue'),
          meta: { title: 'Billing', permission: PERMISSIONS.SETTINGS_MANAGE },
        },
      ],
    },
    notFoundRoute,
  ]
}

/** Forgot / reset password pages, the same on client subdomains and the owner panel. */
const passwordPages = (): RouteRecordRaw[] => [
  guestPage(
    '/forgot-password',
    () => import('@/features/auth/ForgotPasswordPage.vue'),
    'Forgot password',
  ),
  guestPage(
    '/reset-password',
    () => import('@/features/auth/ResetPasswordPage.vue'),
    'Reset password',
  ),
]

function ownerRoutes(): RouteRecordRaw[] {
  return [
    guestPage('/signin', SignInPage, 'Sign in'),
    ...passwordPages(),
    {
      path: '/',
      component: AdminLayout,
      meta: { auth: true },
      redirect: '/organizations',
      children: [
        {
          path: 'organizations',
          component: () => import('@/features/owner/OrganizationsPage.vue'),
          meta: { title: 'Clients' },
        },
        {
          path: 'account/security',
          component: () => import('@/features/account/SecurityPage.vue'),
          meta: { title: 'My Security' },
        },
        {
          path: 'organizations/:id',
          component: () => import('@/features/owner/OrganizationPage.vue'),
          meta: { title: 'Client' },
        },
        {
          path: 'plans',
          component: () => import('@/features/owner/PlansPage.vue'),
          meta: { title: 'Plans' },
        },
        {
          path: 'revenue',
          component: () => import('@/features/owner/RevenuePage.vue'),
          meta: { title: 'Revenue' },
        },
      ],
    },
    notFoundRoute,
  ]
}

/** A single full-screen message for every path. */
function messageRoutes(title: string, message: string): RouteRecordRaw[] {
  return [
    {
      path: '/:pathMatch(.*)*',
      component: MessagePage,
      props: { title, message },
      meta: { title },
    },
  ]
}

function routesFor(workspace: Workspace): RouteRecordRaw[] {
  switch (workspace.kind) {
    case 'tenant':
      if (workspace.status === 'suspended' || workspace.status === 'closed') {
        return messageRoutes(
          'Workspace suspended',
          `${workspace.name} is currently suspended. Please contact your administrator.`,
        )
      }
      return tenantRoutes()
    case 'owner':
      return ownerRoutes()
    case 'root':
      return messageRoutes(
        PRODUCT_NAME,
        'Open your company’s address (yourcompany.' + location.host + ') to sign in.',
      )
    case 'not-found':
      return messageRoutes(
        'Workspace not found',
        'There is no workspace at this address. Check the link you were given.',
      )
    default:
      return messageRoutes(
        'Cannot reach the server',
        'Please check your connection and reload the page.',
      )
  }
}

export function buildRouter(workspace: Workspace) {
  const router = createRouter({ history: createWebHistory(), routes: routesFor(workspace) })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    if (to.meta.auth || to.meta.guest) await auth.restore()

    if (to.matched.some((r) => r.meta.auth) && !auth.isSignedIn) {
      return { path: '/signin', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
    }
    if (to.meta.guest && auth.isSignedIn) return '/'
    // A workspace that requires two-step login allows nothing else until it is set up.
    if (auth.isSignedIn && auth.mustSetUpTwoFactor && to.path !== '/account/security') {
      return '/account/security'
    }
    if (to.meta.permission && !auth.can(to.meta.permission)) return '/'
    return true
  })

  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · ${PRODUCT_NAME}` : PRODUCT_NAME
  })

  return router
}
