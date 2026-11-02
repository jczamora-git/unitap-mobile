<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonIcon,
  IonSpinner,
  IonSearchbar,
  onIonViewWillEnter,
} from '@ionic/vue';
import {
  receiptOutline,
  cashOutline,
  peopleOutline,
  calendarOutline,
  statsChartOutline,
  addOutline,
  checkmarkCircle,
  alertCircle,
  printOutline,
} from 'ionicons/icons';

import { financeService } from '@/services/finance.service';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import type { Semester } from '@/types/database';
import type {
  FinanceSummary,
  StudentObligationItem,
  PaymentItem,
  PaymentReceipt,
} from '@/types/finance';
import { formatPeso } from '@/utilities/finance-formatters';
import {
  formatAcademicPeriod,
  formatObligationStatus,
  formatPaymentMethod,
} from '@/utilities/presentation-formatters';
import {
  UniPageHeader,
  UniHeroCard,
  UniStatCard,
  UniCard,
  UniSheet,
  UniButton,
  UniEmptyState,
  UniSelect,
  UniPagination,
  UniSegmentedControl,
} from '@/components/ui';

import { haptics } from '@/utilities/haptics';

const router = useRouter();

const activeTab = ref<'OVERVIEW' | 'FINES' | 'CONTRIBUTIONS' | 'PAYMENTS'>('OVERVIEW');
const tabRefs = ref<Record<string, HTMLElement | null>>({});

function setTabRef(tab: string, el: any) {
  if (el) {
    tabRefs.value[tab] = el.$el || el;
  }
}

function selectTab(tab: 'OVERVIEW' | 'FINES' | 'CONTRIBUTIONS' | 'PAYMENTS') {
  activeTab.value = tab;
  haptics.light();
  nextTick(() => {
    const el = tabRefs.value[tab];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  });
}

watch(activeTab, (newTab) => {
  nextTick(() => {
    const el = tabRefs.value[newTab];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  });
});
const semesters = ref<Semester[]>([]);
const selectedSemesterId = ref<string>('');

const semesterOptions = computed(() =>
  semesters.value.map((sem) => ({
    value: sem.id,
    label: formatAcademicPeriod(sem.term, sem.academic_year_id),
    badge: sem.status === 'ACTIVE' ? 'Active' : undefined,
  }))
);

function handleSelectSemester(semId: string | number) {
  const targetId = String(semId);
  if (selectedSemesterId.value !== targetId) {
    selectedSemesterId.value = targetId;
    haptics.light();
    loadFinanceData();
  }
}






const summary = ref<FinanceSummary>({
  totalOutstandingCentavos: 0,
  totalPaymentsCollectedCentavos: 0,
  totalAssessedCentavos: 0,
  unpaidFinesCount: 0,
  unpaidContributionsCount: 0,
  activeFinesCount: 0,
  activeContributionsCount: 0,
});

const fines = ref<StudentObligationItem[]>([]);
const contributions = ref<StudentObligationItem[]>([]);
const payments = ref<PaymentItem[]>([]);
const isLoading = ref(true);

// Receipt modal state
const selectedPayment = ref<PaymentItem | null>(null);
const paymentReceipt = ref<PaymentReceipt | null>(null);
const isReceiptModalOpen = ref(false);

// Reversal dialog state
const isReversalModalOpen = ref(false);
const reversingPaymentId = ref<string>('');
const reversalReason = ref<string>('');
const isReversing = ref(false);
const reversalError = ref<string | null>(null);

// Void obligation state
const isVoidModalOpen = ref(false);
const voidingObligationId = ref<string>('');
const voidReason = ref<string>('');
const isVoiding = ref(false);

// Filters
const searchQuery = ref('');
const filterStatus = ref<'ALL' | 'UNPAID' | 'PAID'>('ALL');
const statusFilterOptions = [
  { value: 'ALL', label: 'All' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PAID', label: 'Paid' },
];

const filteredFines = computed(() => {
  return fines.value.filter((f) => {
    if (filterStatus.value === 'UNPAID' && f.status === 'PAID') return false;
    if (filterStatus.value === 'PAID' && f.status !== 'PAID') return false;
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = (f.studentName || '').toLowerCase().includes(q);
      const matchId = (f.schoolId || '').toLowerCase().includes(q);
      const matchTitle = f.title.toLowerCase().includes(q);
      if (!matchName && !matchId && !matchTitle) return false;
    }
    return true;
  });
});

const filteredContributions = computed(() => {
  return contributions.value.filter((c) => {
    if (filterStatus.value === 'UNPAID' && c.status === 'PAID') return false;
    if (filterStatus.value === 'PAID' && c.status !== 'PAID') return false;
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = (c.studentName || '').toLowerCase().includes(q);
      const matchId = (c.schoolId || '').toLowerCase().includes(q);
      const matchTitle = c.title.toLowerCase().includes(q);
      if (!matchName && !matchId && !matchTitle) return false;
    }
    return true;
  });
});

const filteredPayments = computed(() => {
  return payments.value.filter((p) => {
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = (p.studentName || '').toLowerCase().includes(q);
      const matchRef = p.referenceNumber.toLowerCase().includes(q);
      if (!matchName && !matchRef) return false;
    }
    return true;
  });
});

// Pagination state
const finesPage = ref(1);
const finesPageSize = ref(10);
const paginatedFines = computed(() => {
  const start = (finesPage.value - 1) * finesPageSize.value;
  return filteredFines.value.slice(start, start + finesPageSize.value);
});

const contributionsPage = ref(1);
const contributionsPageSize = ref(10);
const paginatedContributions = computed(() => {
  const start = (contributionsPage.value - 1) * contributionsPageSize.value;
  return filteredContributions.value.slice(start, start + contributionsPageSize.value);
});

const paymentsPage = ref(1);
const paymentsPageSize = ref(10);
const paginatedPayments = computed(() => {
  const start = (paymentsPage.value - 1) * paymentsPageSize.value;
  return filteredPayments.value.slice(start, start + paymentsPageSize.value);
});

watch([filterStatus, searchQuery, selectedSemesterId], () => {
  finesPage.value = 1;
  contributionsPage.value = 1;
  paymentsPage.value = 1;
});


async function loadFinanceData() {
  isLoading.value = true;
  try {
    const activeSem = await AcademicRepository.getActiveSemester();
    semesters.value = await AcademicRepository.getSemesters();

    if (activeSem && !selectedSemesterId.value) {
      selectedSemesterId.value = activeSem.id;
    } else if (semesters.value.length > 0 && !selectedSemesterId.value) {
      selectedSemesterId.value = semesters.value[0].id;
    }

    if (selectedSemesterId.value) {
      summary.value = await financeService.getFinanceSummary(selectedSemesterId.value);
      fines.value = await financeService.getObligationsBySemester(selectedSemesterId.value, 'FINE');
      contributions.value = await financeService.getObligationsBySemester(
        selectedSemesterId.value,
        'CONTRIBUTION'
      );
      payments.value = await financeService.getAllPayments(selectedSemesterId.value);
    }
  } catch (err) {
    console.error('Error loading finance data:', err);
  } finally {
    isLoading.value = false;
  }
}

async function viewReceipt(pay: PaymentItem) {
  haptics.light();
  selectedPayment.value = pay;
  paymentReceipt.value = await financeService.generatePaymentReceipt(pay.id, 'Authorized Officer');
  isReceiptModalOpen.value = true;
}

function printReceipt() {
  if (!paymentReceipt.value) return;
  const html = financeService.generatePrintableReceiptHtml(paymentReceipt.value);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }
}

function openReversalModal(paymentId: string) {
  haptics.medium();
  reversingPaymentId.value = paymentId;
  reversalReason.value = '';
  reversalError.value = null;
  isReversalModalOpen.value = true;
}

async function confirmPaymentReversal() {
  if (!reversalReason.value.trim()) {
    reversalError.value = 'Reversal reason is mandatory.';
    return;
  }

  isReversing.value = true;
  reversalError.value = null;

  try {
    await financeService.reversePayment(
      reversingPaymentId.value,
      reversalReason.value.trim(),
      'officer_local'
    );
    haptics.success();
    isReversalModalOpen.value = false;
    await loadFinanceData();
  } catch (err: any) {
    console.error('Reversal failed:', err);
    reversalError.value = err.message || 'Payment reversal failed.';
    haptics.error();
  } finally {
    isReversing.value = false;
  }
}

function openVoidModal(obligationId: string) {
  haptics.medium();
  voidingObligationId.value = obligationId;
  voidReason.value = '';
  isVoidModalOpen.value = true;
}

async function confirmVoidObligation() {
  if (!voidReason.value.trim()) return;
  isVoiding.value = true;
  try {
    await financeService.voidObligation(voidingObligationId.value, voidReason.value.trim(), 'officer_local');
    haptics.success();
    isVoidModalOpen.value = false;
    await loadFinanceData();
  } catch (err) {
    console.error('Failed to void obligation:', err);
  } finally {
    isVoiding.value = false;
  }
}

onMounted(loadFinanceData);
onIonViewWillEnter(loadFinanceData);
</script>

<template>
  <ion-page>
    <UniPageHeader
      title="Finance"
      subtitle="Fines, contributions & payment records"
      variant="root"
    />

    <ion-content class="safe-content">
      <div class="page-container">
        <!-- Semester Selection & Tab Header Strip -->
        <div class="finance-header-strip">
          <div class="term-picker-box">
            <label class="term-label">Academic Period</label>
            <UniSelect
              :model-value="selectedSemesterId"
              :options="semesterOptions"
              placeholder="Select Academic Period"
              header="Select Academic Period"
              empty-placeholder="No academic periods available"
              @change="handleSelectSemester"
            />
          </div>


          <!-- Horizontal Scrollable Pill Tabs (Matching Students Page Tabs) -->
          <div class="filter-chips-scroller finance-tabs" role="tablist" aria-label="Finance navigation tabs">
            <button
              :ref="(el) => setTabRef('OVERVIEW', el)"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'OVERVIEW'"
              class="filter-chip finance-tab"
              :class="{ active: activeTab === 'OVERVIEW', 'chip-active': activeTab === 'OVERVIEW' }"
              @click="selectTab('OVERVIEW')"
            >
              Overview
            </button>
            <button
              :ref="(el) => setTabRef('FINES', el)"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'FINES'"
              class="filter-chip finance-tab"
              :class="{ active: activeTab === 'FINES', 'chip-active': activeTab === 'FINES' }"
              @click="selectTab('FINES')"
            >
              Fines ({{ fines.length }})
            </button>
            <button
              :ref="(el) => setTabRef('CONTRIBUTIONS', el)"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'CONTRIBUTIONS'"
              class="filter-chip finance-tab"
              :class="{ active: activeTab === 'CONTRIBUTIONS', 'chip-active': activeTab === 'CONTRIBUTIONS' }"
              @click="selectTab('CONTRIBUTIONS')"
            >
              Contributions ({{ contributions.length }})
            </button>
            <button
              :ref="(el) => setTabRef('PAYMENTS', el)"
              type="button"
              role="tab"
              :aria-selected="activeTab === 'PAYMENTS'"
              class="filter-chip finance-tab"
              :class="{ active: activeTab === 'PAYMENTS', 'chip-active': activeTab === 'PAYMENTS' }"
              @click="selectTab('PAYMENTS')"
            >
              Payments ({{ payments.length }})
            </button>
          </div>
        </div>

        <!-- TAB 1: OVERVIEW -->
        <template v-if="activeTab === 'OVERVIEW'">
          <!-- Structured Hero Receivables Card -->
          <UniHeroCard gradient="primary" class="finance-hero">
            <div class="hero-top-row">
              <div class="hero-title-group">
                <span class="hero-overline">
                  <span class="pulse-dot"></span> Active Term Receivables
                </span>
                <span class="hero-sublabel">Total Outstanding Balance</span>
              </div>
              <span class="hero-wallets-tag font-mono">
                {{ summary.unpaidFinesCount + summary.unpaidContributionsCount }} Unpaid
              </span>
            </div>

            <div class="hero-balance-row">
              <span class="hero-balance-figure tabular-nums font-mono">
                {{ formatPeso(summary.totalOutstandingCentavos) }}
              </span>
            </div>

            <div class="hero-bottom-row">
              <span class="hero-caption">Uncollected fines and organizational dues for selected term</span>
              <span class="demo-subtle-pill font-mono">Direct Collections</span>
            </div>
          </UniHeroCard>

          <!-- 2 Secondary Stat Cards -->
          <div class="summary-cards-grid">
            <UniStatCard
              label="Total Assessed"
              :value="formatPeso(summary.totalAssessedCentavos)"
              meta="All issued fees"
              :interactive="false"
            >
              <template #top-right>
                <ion-icon :icon="receiptOutline" class="check-lead text-primary" />
              </template>
            </UniStatCard>

            <UniStatCard
              label="Total Collected"
              :value="formatPeso(summary.totalPaymentsCollectedCentavos)"
              value-color="success"
              meta="Verified collections"
              :interactive="false"
            >
              <template #top-right>
                <ion-icon :icon="checkmarkCircle" class="check-lead text-success" />
              </template>
            </UniStatCard>
          </div>

          <!-- Quick Action Navigation Icons (1 Row, Pure Icons) -->
          <div class="quick-action-icons-row" role="group" aria-label="Finance quick actions">
            <button
              type="button"
              class="quick-action-icon-btn"
              title="Event Absentees"
              aria-label="Event Absentees"
              @click="haptics.light(); router.push('/finance/absentees')"
            >
              <ion-icon :icon="calendarOutline" class="action-btn-glyph" />
            </button>

            <button
              type="button"
              class="quick-action-icon-btn"
              title="Contributions"
              aria-label="Contributions"
              @click="haptics.light(); router.push('/finance/contributions')"
            >
              <ion-icon :icon="peopleOutline" class="action-btn-glyph" />
            </button>

            <button
              type="button"
              class="quick-action-icon-btn"
              title="Record Payment"
              aria-label="Record Payment"
              @click="haptics.light(); router.push('/finance/pay')"
            >
              <ion-icon :icon="cashOutline" class="action-btn-glyph" />
            </button>

            <button
              type="button"
              class="quick-action-icon-btn"
              title="Financial Reports"
              aria-label="Financial Reports"
              @click="haptics.light(); router.push('/finance/reports')"
            >
              <ion-icon :icon="statsChartOutline" class="action-btn-glyph" />
            </button>
          </div>

          <!-- Recent Payments Snippet -->
          <UniCard padding="md" class="recent-payments-card">
            <div class="card-head-row">
              <span class="card-head-title">Recent Payment Records</span>
              <button class="link-btn" @click="selectTab('PAYMENTS')">
                View all
              </button>
            </div>

            <div v-if="payments.length > 0" class="mini-list">
              <div
                v-for="p in payments.slice(0, 5)"
                :key="p.id"
                class="mini-item"
                @click="viewReceipt(p)"
              >
                <div class="item-lead">
                  <span class="item-title font-mono font-bold">{{ p.referenceNumber }}</span>
                  <span class="item-sub">{{ p.studentName || 'Student' }} • {{ new Date(p.processedAt).toLocaleDateString() }}</span>
                </div>
                <div class="item-trail">
                  <span
                    class="item-amount font-mono font-bold"
                    :class="p.status === 'POSTED' ? 'text-success' : 'text-muted strike'"
                  >
                    {{ formatPeso(p.amountCentavos) }}
                  </span>
                  <span class="badge-mini" :class="p.status === 'POSTED' ? 'badge-success' : 'badge-danger'">
                    {{ p.status === 'POSTED' ? 'Posted' : (p.status === 'REVERSED' ? 'Reversed' : p.status) }}
                  </span>
                </div>
              </div>
            </div>

            <UniEmptyState
              v-else
              title="No Payments Recorded"
              description="Recorded student payments will appear here."
              :icon="receiptOutline"
            />
          </UniCard>
        </template>

        <!-- TAB 2: FINES MANAGEMENT -->
        <template v-else-if="activeTab === 'FINES'">
          <div class="tab-toolbar-stack">
            <div class="toolbar-row">
              <ion-searchbar
                v-model="searchQuery"
                placeholder="Search student or fine title..."
                class="clean-searchbar"
                :debounce="200"
              />
              <div class="toolbar-actions">
                <UniButton
                  variant="outline"
                  size="sm"
                  :icon="calendarOutline"
                  @click="router.push('/finance/absentees')"
                >
                  Absentees
                </UniButton>
                <UniButton
                  variant="primary"
                  size="sm"
                  :icon="addOutline"
                  @click="router.push('/finance/charges/create')"
                >
                  Fine
                </UniButton>
              </div>
            </div>

            <UniSegmentedControl
              v-model="filterStatus"
              :options="statusFilterOptions"
              size="sm"
            />
          </div>

          <UniCard v-if="filteredFines.length > 0" padding="none">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Fine Title</th>
                    <th>Amount</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in paginatedFines" :key="f.id">
                    <td>
                      <div class="student-col">
                        <span class="font-bold">{{ f.studentName || 'Student' }}</span>
                        <span class="sub-meta font-mono">{{ f.schoolId }} • {{ f.yearLevel }}-{{ f.section }}</span>
                      </div>
                    </td>
                    <td class="font-bold">{{ f.title }}</td>
                    <td class="font-mono">{{ formatPeso(f.amountCentavos) }}</td>
                    <td class="font-mono text-success">{{ formatPeso(f.paidCentavos) }}</td>
                    <td class="font-mono font-bold" :class="f.balanceCentavos > 0 ? 'text-danger' : 'text-success'">
                      {{ formatPeso(f.balanceCentavos) }}
                    </td>
                    <td>
                      <span
                        class="badge-mini"
                        :class="f.status === 'PAID' ? 'badge-success' : (f.status === 'VOID' ? 'badge-neutral' : 'badge-danger')"
                      >
                        {{ formatObligationStatus(f.status) }}
                      </span>
                    </td>
                    <td>
                      <button
                        v-if="f.status !== 'PAID' && f.status !== 'VOID'"
                        class="action-link-btn"
                        @click="openVoidModal(f.id)"
                      >
                        Waive / Void
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <UniPagination
              v-model:current-page="finesPage"
              v-model:page-size="finesPageSize"
              :total-items="filteredFines.length"
            />
          </UniCard>


          <UniEmptyState
            v-else
            title="No Fines Found"
            description="Use Event Absentees to bulk fine absent students or create a manual fine."
            :icon="checkmarkCircle"
          />
        </template>

        <!-- TAB 3: CONTRIBUTIONS MANAGEMENT -->
        <template v-else-if="activeTab === 'CONTRIBUTIONS'">
          <div class="tab-toolbar-stack">
            <div class="toolbar-row">
              <ion-searchbar
                v-model="searchQuery"
                placeholder="Search student or contribution title..."
                class="clean-searchbar"
                :debounce="200"
              />
              <UniButton
                variant="primary"
                size="sm"
                :icon="addOutline"
                @click="router.push('/finance/contributions')"
              >
                Assign
              </UniButton>
            </div>

            <UniSegmentedControl
              v-model="filterStatus"
              :options="statusFilterOptions"
              size="sm"
            />
          </div>

          <UniCard v-if="filteredContributions.length > 0" padding="none">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Contribution Title</th>
                    <th>Amount</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in paginatedContributions" :key="c.id">
                    <td>
                      <div class="student-col">
                        <span class="font-bold">{{ c.studentName || 'Student' }}</span>
                        <span class="sub-meta font-mono">{{ c.schoolId }} • {{ c.yearLevel }}-{{ c.section }}</span>
                      </div>
                    </td>
                    <td class="font-bold">{{ c.title }}</td>
                    <td class="font-mono">{{ formatPeso(c.amountCentavos) }}</td>
                    <td class="font-mono text-success">{{ formatPeso(c.paidCentavos) }}</td>
                    <td class="font-mono font-bold" :class="c.balanceCentavos > 0 ? 'text-danger' : 'text-success'">
                      {{ formatPeso(c.balanceCentavos) }}
                    </td>
                    <td>
                      <span
                        class="badge-mini"
                        :class="c.status === 'PAID' ? 'badge-success' : 'badge-warning'"
                      >
                        {{ formatObligationStatus(c.status) }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <UniPagination
              v-model:current-page="contributionsPage"
              v-model:page-size="contributionsPageSize"
              :total-items="filteredContributions.length"
            />
          </UniCard>


          <UniEmptyState
            v-else
            title="No Contributions Found"
            description="Assign semester contributions to students in bulk."
            :icon="peopleOutline"
          />
        </template>

        <!-- TAB 4: PAYMENT RECORDS -->
        <template v-else-if="activeTab === 'PAYMENTS'">
          <div class="tab-toolbar-stack">
            <div class="toolbar-row">
              <ion-searchbar
                v-model="searchQuery"
                placeholder="Search reference # or student..."
                class="clean-searchbar"
                :debounce="200"
              />
              <UniButton
                variant="primary"
                size="sm"
                :icon="cashOutline"
                @click="router.push('/finance/pay')"
              >
                Record
              </UniButton>
            </div>
          </div>

          <UniCard v-if="filteredPayments.length > 0" padding="none">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Student</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in paginatedPayments" :key="p.id">
                    <td class="font-mono font-bold">{{ p.referenceNumber }}</td>
                    <td>
                      <div class="student-col">
                        <span class="font-bold">{{ p.studentName || 'Student' }}</span>
                        <span class="sub-meta font-mono">{{ p.studentSchoolId }}</span>
                      </div>
                    </td>
                    <td>{{ new Date(p.processedAt).toLocaleDateString() }}</td>
                    <td>
                      <span class="badge-mini badge-neutral">{{ formatPaymentMethod(p.source) }}</span>
                    </td>
                    <td
                      class="font-mono font-bold"
                      :class="p.status === 'POSTED' ? 'text-success' : 'text-muted strike'"
                    >
                      {{ formatPeso(p.amountCentavos) }}
                    </td>
                    <td>
                      <span
                        class="badge-mini"
                        :class="p.status === 'POSTED' ? 'badge-success' : 'badge-danger'"
                      >
                        {{ p.status === 'POSTED' ? 'Posted' : (p.status === 'REVERSED' ? 'Reversed' : p.status) }}
                      </span>
                    </td>
                    <td>
                      <div class="row-actions">
                        <button class="action-link-btn" @click="viewReceipt(p)">
                          Receipt
                        </button>
                        <button
                          v-if="p.status === 'POSTED'"
                          class="action-link-btn text-danger"
                          @click="openReversalModal(p.id)"
                        >
                          Reverse
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <UniPagination
              v-model:current-page="paymentsPage"
              v-model:page-size="paymentsPageSize"
              :total-items="filteredPayments.length"
            />
          </UniCard>


          <UniEmptyState
            v-else
            title="No Payment Records Found"
            description="Record payments received from students against their fines or contributions."
            :icon="receiptOutline"
          />
        </template>
      </div>

      <!-- Payment Receipt Modal -->
      <UniSheet
        :is-open="isReceiptModalOpen"
        title="Official Payment Receipt"
        @close="isReceiptModalOpen = false"
      >
        <div v-if="paymentReceipt" class="receipt-wrap">
          <div class="receipt-header">
            <div class="receipt-brand">UniTap 2.0</div>
            <div class="receipt-subtitle">Computer Studies Government (CSG)</div>
            <span class="badge-mini badge-warning">Official Payment Record</span>
          </div>

          <div class="receipt-meta font-mono">
            <div class="rec-row"><span>Ref #:</span><strong>{{ paymentReceipt.referenceNumber }}</strong></div>
            <div class="rec-row"><span>Date:</span><span>{{ new Date(paymentReceipt.paymentDate).toLocaleString() }}</span></div>
            <div class="rec-row"><span>Student:</span><strong>{{ paymentReceipt.student.fullName }}</strong></div>
            <div class="rec-row"><span>School ID:</span><span>{{ paymentReceipt.student.schoolId }}</span></div>
            <div class="rec-row"><span>Method:</span><span>{{ formatPaymentMethod(paymentReceipt.paymentMethod) }}</span></div>
          </div>

          <div class="receipt-items">
            <div v-for="it in paymentReceipt.items" :key="it.obligationId" class="rec-item">
              <div>
                <span class="font-bold">{{ it.title }}</span>
                <span class="sub-meta font-mono">Remaining: {{ formatPeso(it.remainingBalanceCentavos) }}</span>
              </div>
              <span class="font-mono font-bold text-success">{{ formatPeso(it.paidAmountCentavos) }}</span>
            </div>
          </div>

          <div class="receipt-total-box font-mono">
            <span>TOTAL PAID:</span>
            <span class="font-bold text-success font-xl">{{ formatPeso(paymentReceipt.totalPaidCentavos) }}</span>
          </div>

          <div class="sheet-actions">
            <UniButton variant="outline" @click="printReceipt">
              <ion-icon :icon="printOutline" slot="start" />
              <span>Print PDF</span>
            </UniButton>
            <UniButton variant="primary" @click="isReceiptModalOpen = false">
              <span>Close</span>
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- Payment Reversal Dialog -->
      <UniSheet
        :is-open="isReversalModalOpen"
        title="Reverse Payment Record"
        @close="isReversalModalOpen = false"
      >
        <div class="sheet-form">
          <div v-if="reversalError" class="alert-box error-box">
            <ion-icon :icon="alertCircle" class="alert-icon" />
            <div class="alert-text">{{ reversalError }}</div>
          </div>

          <p class="dialog-text">
            Reversing a payment will restore the student's obligation balance. This action is permanently audited.
          </p>

          <div class="form-group">
            <label class="field-label">Mandatory Reversal Reason <span class="req">*</span></label>
            <textarea
              v-model="reversalReason"
              rows="3"
              class="clean-textarea"
              placeholder="e.g. Erroneous cash recording / Student requested official refund"
            ></textarea>
          </div>

          <div class="sheet-actions">
            <UniButton variant="outline" @click="isReversalModalOpen = false">
              Cancel
            </UniButton>
            <UniButton
              variant="destructive"
              :disabled="isReversing || !reversalReason.trim()"
              @click="confirmPaymentReversal"
            >
              <ion-spinner v-if="isReversing" name="crescent" slot="start" />
              <span>Confirm Reversal</span>
            </UniButton>
          </div>
        </div>
      </UniSheet>

      <!-- Void / Waive Obligation Dialog -->
      <UniSheet
        :is-open="isVoidModalOpen"
        title="Waive / Void Obligation"
        @close="isVoidModalOpen = false"
      >
        <div class="sheet-form">
          <p class="dialog-text">
            Are you sure you want to void this fine? The obligation will be cancelled and zeroed.
          </p>
          <div class="form-group">
            <label class="field-label">Reason for Waiver <span class="req">*</span></label>
            <input
              v-model="voidReason"
              type="text"
              class="clean-input"
              placeholder="e.g. Authorized officer waiver due to medical excuse"
            />
          </div>
          <div class="sheet-actions">
            <UniButton variant="outline" @click="isVoidModalOpen = false">
              Cancel
            </UniButton>
            <UniButton
              variant="destructive"
              :disabled="isVoiding || !voidReason.trim()"
              @click="confirmVoidObligation"
            >
              <ion-spinner v-if="isVoiding" name="crescent" slot="start" />
              <span>Confirm Waiver</span>
            </UniButton>
          </div>
        </div>
      </UniSheet>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.page-container {
  padding: 4px 0 16px 0;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.finance-header-strip {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.term-picker-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.term-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--uni-text-secondary);
}

.custom-dropdown-container {
  position: relative;
  width: 100%;
  z-index: 30;
}

.custom-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: transparent;
}

.custom-dropdown-trigger {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: var(--uni-radius-card, 14px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  outline: none;
  box-shadow: none;
  user-select: none;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.custom-dropdown-trigger.is-open {
  border-color: var(--uni-border-focus, #0f766e);
}

.custom-dropdown-trigger:hover {
  background: var(--uni-surface-secondary, #f8fafc);
}

.dropdown-trigger-text {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--uni-text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-chevron-icon {
  font-size: 16px;
  color: var(--uni-text-secondary, #64748b);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.16s ease;
  flex-shrink: 0;
  margin-left: 8px;
}

.dropdown-chevron-icon.is-rotated {
  transform: rotate(180deg);
  color: var(--uni-primary, #0f766e);
}

.custom-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.1);
  padding: 6px;
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  scrollbar-width: thin;
}

:root.dark .custom-dropdown-menu,
:root.ion-palette-dark .custom-dropdown-menu,
body.dark .custom-dropdown-menu,
body.ion-palette-dark .custom-dropdown-menu {
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.5);
  background: var(--uni-surface, #1e293b);
  border-color: var(--uni-border, #334155);
}

.custom-dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  user-select: none;
  outline: none;
  transition: background-color 0.14s ease, color 0.14s ease;
}

.custom-dropdown-item:hover {
  background: var(--uni-surface-secondary, #f1f5f9);
}

.custom-dropdown-item.is-selected {
  background: rgba(15, 118, 110, 0.08);
}

:root.dark .custom-dropdown-item.is-selected,
:root.ion-palette-dark .custom-dropdown-item.is-selected,
body.dark .custom-dropdown-item.is-selected,
body.ion-palette-dark .custom-dropdown-item.is-selected {
  background: rgba(13, 148, 136, 0.16);
}

.item-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--uni-text, #0f172a);
  flex: 1;
}

.custom-dropdown-item.is-selected .item-label {
  font-weight: 700;
  color: var(--uni-primary, #0f766e);
}

:root.dark .custom-dropdown-item.is-selected .item-label,
:root.ion-palette-dark .custom-dropdown-item.is-selected .item-label,
body.dark .custom-dropdown-item.is-selected .item-label,
body.ion-palette-dark .custom-dropdown-item.is-selected .item-label {
  color: var(--uni-btn-primary-bg, #0D9488);
}

.item-active-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 9999px;
  background: rgba(15, 118, 110, 0.12);
  color: var(--uni-primary, #0f766e);
  margin-right: 8px;
  text-transform: uppercase;
}

.item-check-icon {
  font-size: 16px;
  color: var(--uni-primary, #0f766e);
  flex-shrink: 0;
}

/* Dropdown Animation */
.dropdown-pop-enter-active,
.dropdown-pop-leave-active {
  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.dropdown-pop-enter-from,
.dropdown-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

/* Filter Chips / Tabs (Matching Students Page Tabs) */
.filter-chips-scroller.finance-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  flex-wrap: nowrap;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.filter-chips-scroller.finance-tabs::-webkit-scrollbar {
  display: none;
}

.filter-chip.finance-tab {
  flex: 0 0 auto;
  padding: 6px 14px;
  border-radius: var(--app-pill-radius, 9999px);
  background: var(--app-surface-subtle);
  border: 1px solid var(--app-border);
  color: var(--app-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  outline: none;
  box-shadow: none;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
}

.filter-chip.finance-tab:active {
  transform: scale(0.97);
}

.filter-chip.finance-tab:focus-visible {
  outline: 2px solid var(--uni-border-focus, #0F766E);
  outline-offset: 1px;
}

/* Active Tab Style (Matching Students Page chip-active) */
.filter-chip.finance-tab.active,
.filter-chip.finance-tab.chip-active {
  background: var(--ion-color-primary, #0F766E);
  border-color: var(--ion-color-primary, #0F766E);
  color: #ffffff;
  font-weight: 600;
  box-shadow: none;
}

:root.dark .filter-chip.finance-tab,
:root.ion-palette-dark .filter-chip.finance-tab,
body.dark .filter-chip.finance-tab,
body.ion-palette-dark .filter-chip.finance-tab {
  background: var(--uni-surface-secondary);
  border-color: var(--uni-border);
  color: var(--uni-text-secondary);
}

:root.dark .filter-chip.finance-tab.active,
:root.dark .filter-chip.finance-tab.chip-active,
:root.ion-palette-dark .filter-chip.finance-tab.active,
:root.ion-palette-dark .filter-chip.finance-tab.chip-active,
body.dark .filter-chip.finance-tab.active,
body.dark .filter-chip.finance-tab.chip-active,
body.ion-palette-dark .filter-chip.finance-tab.active,
body.ion-palette-dark .filter-chip.finance-tab.chip-active {
  background: var(--uni-btn-primary-bg, #0D9488);
  border-color: var(--uni-btn-primary-bg, #0D9488);
  color: #ffffff;
  font-weight: 600;
  box-shadow: none;
}

/* Hero Receivables Card */
.finance-hero {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hero-top-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.hero-title-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hero-overline {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--uni-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.hero-sublabel {
  font-size: 13px;
  font-weight: 600;
  color: var(--uni-text-secondary);
}

.hero-wallets-tag {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 9999px;
  background: rgba(217, 119, 6, 0.12);
  color: var(--uni-warning, #D97706);
  border: 1px solid rgba(217, 119, 6, 0.25);
  white-space: nowrap;
}

:root.dark .hero-wallets-tag,
:root.ion-palette-dark .hero-wallets-tag {
  background: rgba(251, 191, 36, 0.16);
  color: #FBBF24;
  border-color: rgba(251, 191, 36, 0.3);
}

.hero-balance-row {
  padding: 2px 0;
}

.hero-balance-figure {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: var(--uni-text);
}

:root.dark .hero-balance-figure,
:root.ion-palette-dark .hero-balance-figure {
  color: #FFFFFF;
}

.hero-bottom-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--uni-border);
  flex-wrap: wrap;
}

.hero-caption {
  font-size: 12px;
  color: var(--uni-text-secondary);
  flex: 1;
  min-width: 180px;
}

.demo-subtle-pill {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--uni-surface-secondary);
  color: var(--uni-text-secondary);
  border: 1px solid var(--uni-border);
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--uni-primary);
  display: inline-block;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.25);
}

.summary-cards-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.quick-action-icons-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.quick-action-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  background: var(--uni-surface, #ffffff);
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 14px;
  color: var(--uni-text, #0f172a);
  cursor: pointer;
  padding: 0;
  box-shadow: none;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.quick-action-icon-btn:hover {
  background: var(--uni-surface-secondary, #f8fafc);
  border-color: var(--uni-border-focus, #0f766e);
}

.quick-action-icon-btn:active {
  transform: scale(0.94);
  opacity: 0.85;
}

.quick-action-icon-btn .action-btn-glyph {
  font-size: 24px;
  color: var(--uni-text, #0f172a);
  pointer-events: none;
}

@media (max-width: 340px) {
  .quick-action-icons-row {
    gap: 8px;
  }
}

.recent-payments-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-head-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--uni-ink, #0f172a);
}

.link-btn {
  background: transparent;
  border: none;
  color: var(--uni-primary, #0f766e);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.mini-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mini-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--uni-border, #f1f5f9);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.mini-item:hover {
  background: #f8fafc;
}

.item-lead {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-title {
  font-size: 13px;
}

.item-sub {
  font-size: 11px;
  color: var(--uni-muted, #64748b);
}

.item-trail {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.tab-toolbar-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.clean-searchbar {
  --background: var(--uni-surface, #ffffff);
  --color: var(--uni-text, #0f172a);
  --placeholder-color: var(--uni-text-muted, #94a3b8);
  --box-shadow: none;
  --border-radius: 12px;
  padding: 0;
  flex: 1;
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 12px;
  min-height: 40px;
}

:root.dark .clean-searchbar,
:root.ion-palette-dark .clean-searchbar,
body.dark .clean-searchbar,
body.ion-palette-dark .clean-searchbar {
  --background: var(--uni-surface, #1e293b);
  --color: #ffffff;
  --placeholder-color: #94a3b8;
  border-color: var(--uni-border, #334155);
}

.status-segment-bar {
  display: inline-flex;
  background: var(--uni-surface-secondary, #f1f5f9);
  padding: 3px;
  border-radius: 10px;
  gap: 2px;
  align-self: flex-start;
  border: 1px solid var(--uni-border, #e2e8f0);
}

:root.dark .status-segment-bar,
:root.ion-palette-dark .status-segment-bar,
body.dark .status-segment-bar,
body.ion-palette-dark .status-segment-bar {
  background: var(--uni-surface-secondary, #1e293b);
  border-color: var(--uni-border, #334155);
}

.seg-btn {
  background: transparent;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 700;
  color: var(--uni-text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.16s ease;
}

:root.dark .seg-btn,
:root.ion-palette-dark .seg-btn,
body.dark .seg-btn,
body.ion-palette-dark .seg-btn {
  color: #94a3b8;
}

.seg-btn.active {
  background: var(--uni-surface, #ffffff);
  color: var(--uni-primary, #0f766e);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

:root.dark .seg-btn.active,
:root.ion-palette-dark .seg-btn.active,
body.dark .seg-btn.active,
body.ion-palette-dark .seg-btn.active {
  background: var(--uni-btn-primary-bg, #0d9488);
  color: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

.tab-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.tab-heading {
  font-size: 18px;
  font-weight: 900;
  margin: 0;
  color: var(--uni-ink, #0f172a);
}

.tab-sub {
  font-size: 12px;
  color: var(--uni-muted, #64748b);
}

.tab-actions {
  display: flex;
  gap: 8px;
}

.filter-controls-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.clean-search-input {
  flex: 1;
  min-width: 200px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--uni-border, #e2e8f0);
  font-size: 13px;
  outline: none;
}

.status-segment {
  display: flex;
  background: var(--uni-surface-muted, #f1f5f9);
  padding: 3px;
  border-radius: 8px;
  gap: 2px;
}

.table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}

.data-table th {
  background: var(--uni-surface-muted, #f8fafc);
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--uni-muted, #64748b);
  border-bottom: 1px solid var(--uni-border, #e2e8f0);
}

.data-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--uni-border, #f1f5f9);
}

.student-col {
  display: flex;
  flex-direction: column;
}

.sub-meta {
  font-size: 11px;
  color: var(--uni-muted, #64748b);
}

.action-link-btn {
  background: transparent;
  border: none;
  color: var(--uni-primary, #0f766e);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 6px;
}

.action-link-btn.text-danger {
  color: var(--uni-danger, #b91c1c);
}

.row-actions {
  display: flex;
  gap: 6px;
}

.badge-mini {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.badge-success { background: #dcfce7; color: #15803d; }
.badge-warning { background: #fef3c7; color: #b45309; }
.badge-danger { background: #fee2e2; color: #b91c1c; }
.badge-neutral { background: #f1f5f9; color: #64748b; }

.strike { text-decoration: line-through; }

.receipt-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.receipt-header {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.receipt-brand {
  font-size: 18px;
  font-weight: 900;
  color: var(--uni-primary, #0f766e);
}

.receipt-subtitle {
  font-size: 11px;
  color: var(--uni-muted, #64748b);
  margin-bottom: 4px;
}

.receipt-meta {
  background: #f8fafc;
  border: 1px dashed var(--uni-border, #cbd5e1);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.rec-row {
  display: flex;
  justify-content: space-between;
}

.receipt-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px dashed var(--uni-border, #cbd5e1);
  padding-top: 8px;
}

.rec-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.receipt-total-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
  border: 1px solid var(--uni-border, #e2e8f0);
  border-radius: 8px;
  padding: 12px;
}

.font-xl {
  font-size: 18px;
}

.sheet-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.sheet-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.clean-textarea,
.clean-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--uni-border, #cbd5e1);
  font-size: 14px;
  outline: none;
}

.req {
  color: var(--uni-danger, #b91c1c);
}

.alert-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
}

.error-box {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}
</style>
