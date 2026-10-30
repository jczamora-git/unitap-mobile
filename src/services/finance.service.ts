import type { 
  ChargeTemplate, 
  StudentCharge, 
  Wallet, 
  WalletTransaction, 
  Payment,
  PaymentAllocation,
  ChargeType,
  ChargeTrigger,
  FinanceSummary
} from '@/types/finance';
import { localFinanceRepository, type IFinanceRepository } from '@/storage/finance-storage.service';
import { generateReferenceNumber } from '@/utilities/finance-formatters';

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export class FinanceService {
  constructor(private repo: IFinanceRepository = localFinanceRepository) {}

  // ===================== CHARGE TEMPLATES =====================

  async getTemplates(): Promise<ChargeTemplate[]> {
    const store = await this.repo.getData();
    if (store.templates.length === 0) {
      // Seed default CSG templates
      const defaults: ChargeTemplate[] = [
        {
          id: 'tmpl_cleanup',
          name: 'Cleanup Drive Absence',
          chargeType: 'FINE',
          defaultAmount: 2000, // ₱20.00
          triggerType: 'ABSENCE',
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        },
        {
          id: 'tmpl_teachers_day',
          name: "Teacher's Day Contribution",
          chargeType: 'CONTRIBUTION',
          defaultAmount: 2500, // ₱25.00
          triggerType: 'MANUAL',
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        },
        {
          id: 'tmpl_sportsfest',
          name: 'Sportsfest Contribution',
          chargeType: 'CONTRIBUTION',
          defaultAmount: 2500, // ₱25.00
          triggerType: 'EVENT',
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        }
      ];
      store.templates = defaults;
      await this.repo.saveData(store);
    }
    return [...store.templates];
  }

  async createTemplate(params: {
    name: string;
    chargeType: ChargeType;
    defaultAmount: number;
    triggerType: ChargeTrigger;
  }): Promise<ChargeTemplate> {
    if (!params.name || !params.name.trim()) {
      throw new Error('Template name is required.');
    }
    if (params.defaultAmount <= 0) {
      throw new Error('Default amount must be greater than 0.');
    }

    const store = await this.repo.getData();
    const newTmpl: ChargeTemplate = {
      id: generateId('tmpl'),
      name: params.name.trim(),
      chargeType: params.chargeType,
      defaultAmount: Math.round(params.defaultAmount),
      triggerType: params.triggerType,
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    };

    store.templates.unshift(newTmpl);
    await this.repo.saveData(store);
    return newTmpl;
  }

  // ===================== STUDENT CHARGES =====================

  async getCharges(studentId?: string): Promise<StudentCharge[]> {
    const store = await this.repo.getData();
    if (studentId) {
      return store.charges.filter(c => c.studentId === studentId);
    }
    return [...store.charges];
  }

  async issueCharge(params: {
    studentId: string;
    chargeTemplateId?: string;
    title: string;
    chargeType: ChargeType;
    issuedAmount: number; // in centavos
    relatedEventId?: string;
    relatedOccurrenceId?: string;
    remarks?: string;
  }): Promise<StudentCharge> {
    if (!params.studentId) {
      throw new Error('Target student is required.');
    }
    if (!params.title || !params.title.trim()) {
      throw new Error('Charge title is required.');
    }
    if (params.issuedAmount <= 0) {
      throw new Error('Issued charge amount must be greater than 0.');
    }

    const store = await this.repo.getData();
    const now = new Date().toISOString();

    const charge: StudentCharge = {
      id: generateId('chg'),
      studentId: params.studentId,
      chargeTemplateId: params.chargeTemplateId,
      title: params.title.trim(),
      chargeType: params.chargeType,
      issuedAmount: Math.round(params.issuedAmount),
      paidAmount: 0,
      status: 'UNPAID',
      relatedEventId: params.relatedEventId,
      relatedOccurrenceId: params.relatedOccurrenceId,
      remarks: params.remarks?.trim() || undefined,
      issuedAt: now,
      updatedAt: now
    };

    store.charges.unshift(charge);
    await this.repo.saveData(store);
    return charge;
  }

  async voidCharge(chargeId: string, reason: string): Promise<StudentCharge> {
    if (!reason || !reason.trim()) {
      throw new Error('Reason is required to void a charge.');
    }

    const store = await this.repo.getData();
    const target = store.charges.find(c => c.id === chargeId);
    if (!target) {
      throw new Error('Charge not found.');
    }
    if (target.status === 'PAID') {
      throw new Error('Cannot void a fully paid charge.');
    }

    target.status = 'VOID';
    target.voidReason = reason.trim();
    target.updatedAt = new Date().toISOString();

    await this.repo.saveData(store);
    return target;
  }

  // ===================== WALLETS & LEDGER =====================

  async getOrCreateWallet(studentId: string): Promise<Wallet> {
    const store = await this.repo.getData();
    let wallet = store.wallets.find(w => w.studentId === studentId);

    if (!wallet) {
      const now = new Date().toISOString();
      wallet = {
        id: generateId('wal'),
        studentId,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      };
      store.wallets.push(wallet);
      await this.repo.saveData(store);
    }

    return wallet;
  }

  async getWalletTransactions(walletId: string): Promise<WalletTransaction[]> {
    const store = await this.repo.getData();
    return store.transactions.filter(t => t.walletId === walletId);
  }

  async getStudentTransactions(studentId: string): Promise<WalletTransaction[]> {
    const store = await this.repo.getData();
    return store.transactions.filter(t => t.studentId === studentId);
  }

  async calculateWalletBalance(studentId: string): Promise<number> {
    const store = await this.repo.getData();
    const studentTxns = store.transactions.filter(t => t.studentId === studentId);

    let balance = 0;
    for (const txn of studentTxns) {
      switch (txn.type) {
        case 'TOP_UP':
        case 'ADJUSTMENT_ADD':
        case 'PAYMENT_REVERSAL':
          balance += txn.amount;
          break;
        case 'PAYMENT':
        case 'ADJUSTMENT_DEDUCT':
        case 'TOPUP_REVERSAL':
          balance -= txn.amount;
          break;
      }
    }
    return balance;
  }

  async topUpWallet(studentId: string, amountCentavos: number, note?: string): Promise<WalletTransaction> {
    if (amountCentavos <= 0) {
      throw new Error('Top-up amount must be strictly positive.');
    }

    const store = await this.repo.getData();
    let wallet = store.wallets.find(w => w.studentId === studentId);
    if (!wallet) {
      wallet = await this.getOrCreateWallet(studentId);
      // reload store
      return this.topUpWallet(studentId, amountCentavos, note);
    }

    if (wallet.status === 'FROZEN') {
      throw new Error('Cannot top up a FROZEN wallet.');
    }

    const ref = generateReferenceNumber('TOP');
    const transaction: WalletTransaction = {
      id: generateId('txn'),
      walletId: wallet.id,
      studentId,
      type: 'TOP_UP',
      amount: Math.round(amountCentavos),
      referenceNumber: ref,
      description: note?.trim() || 'Simulated Cash Top-up',
      createdAt: new Date().toISOString()
    };

    store.transactions.unshift(transaction);
    await this.repo.saveData(store);
    return transaction;
  }

  // ===================== PAYMENTS & ALLOCATIONS =====================

  async getPayments(studentId?: string): Promise<Payment[]> {
    const store = await this.repo.getData();
    if (studentId) {
      return store.payments.filter(p => p.studentId === studentId);
    }
    return [...store.payments];
  }

  async processPayment(params: {
    studentId: string;
    allocations: Array<{ chargeId: string; amountCentavos: number }>;
    channel: 'NFC' | 'MANUAL';
  }): Promise<Payment> {
    const { studentId, allocations, channel } = params;

    if (!studentId) {
      throw new Error('Student is required.');
    }
    if (!allocations || allocations.length === 0) {
      throw new Error('At least one charge allocation is required.');
    }

    const totalToPay = allocations.reduce((sum, a) => sum + Math.round(a.amountCentavos), 0);
    if (totalToPay <= 0) {
      throw new Error('Total payment amount must be greater than 0.');
    }

    const store = await this.repo.getData();
    const wallet = store.wallets.find(w => w.studentId === studentId);
    if (!wallet) {
      throw new Error('Student does not have an active wallet.');
    }
    if (wallet.status === 'FROZEN') {
      throw new Error('Cannot process payment from a FROZEN wallet.');
    }

    // Verify balance
    const currentBalance = await this.calculateWalletBalance(studentId);
    if (currentBalance < totalToPay) {
      throw new Error(
        `Insufficient wallet balance. Available: ₱${(currentBalance / 100).toFixed(2)}, Required: ₱${(totalToPay / 100).toFixed(2)}.`
      );
    }

    // Verify charges
    const paymentAllocations: PaymentAllocation[] = [];
    const paymentId = generateId('pay');
    const ref = generateReferenceNumber('PAY');
    const now = new Date().toISOString();

    for (const alloc of allocations) {
      const charge = store.charges.find(c => c.id === alloc.chargeId);
      if (!charge) {
        throw new Error(`Charge [${alloc.chargeId}] not found.`);
      }
      if (charge.studentId !== studentId) {
        throw new Error('Cannot pay a charge belonging to another student.');
      }
      if (charge.status === 'VOID') {
        throw new Error(`Cannot pay voided charge: "${charge.title}".`);
      }
      if (charge.status === 'PAID') {
        throw new Error(`Charge "${charge.title}" is already fully paid.`);
      }

      const remaining = charge.issuedAmount - charge.paidAmount;
      if (alloc.amountCentavos > remaining) {
        throw new Error(`Allocation for "${charge.title}" exceeds remaining balance of ₱${(remaining / 100).toFixed(2)}.`);
      }

      // Update charge
      charge.paidAmount += Math.round(alloc.amountCentavos);
      charge.status = charge.paidAmount >= charge.issuedAmount ? 'PAID' : 'PARTIALLY_PAID';
      charge.updatedAt = now;

      paymentAllocations.push({
        id: generateId('alc'),
        paymentId,
        studentChargeId: charge.id,
        amountApplied: Math.round(alloc.amountCentavos)
      });
    }

    // Create payment record
    const payment: Payment = {
      id: paymentId,
      studentId,
      referenceNumber: ref,
      amount: totalToPay,
      paymentSource: 'WALLET',
      paymentChannel: channel,
      status: 'COMPLETED',
      processedAt: now,
      allocations: paymentAllocations
    };

    // Create wallet debit ledger entry
    const debitTxn: WalletTransaction = {
      id: generateId('txn'),
      walletId: wallet.id,
      studentId,
      type: 'PAYMENT',
      amount: totalToPay,
      referenceNumber: ref,
      relatedPaymentId: paymentId,
      description: `Payment for ${allocations.length} charge(s)`,
      createdAt: now
    };

    store.payments.unshift(payment);
    store.transactions.unshift(debitTxn);

    // Atomic commit
    await this.repo.saveData(store);
    return payment;
  }

  async reversePayment(paymentId: string, reason: string, _reversedByUserId = 'officer'): Promise<Payment> {
    if (!reason || !reason.trim()) {
      throw new Error('A reversal reason is mandatory.');
    }

    const store = await this.repo.getData();
    const payment = store.payments.find(p => p.id === paymentId);
    if (!payment) {
      throw new Error('Payment not found.');
    }
    if (payment.status === 'REVERSED') {
      throw new Error('Payment is already reversed.');
    }

    const now = new Date().toISOString();
    payment.status = 'REVERSED';
    (payment as any).reversedAt = now;
    (payment as any).reversalReason = reason.trim();

    // Revert charge paid amounts
    for (const alloc of payment.allocations) {
      const charge = store.charges.find(c => c.id === alloc.studentChargeId);
      if (charge) {
        charge.paidAmount = Math.max(0, charge.paidAmount - alloc.amountApplied);
        if (charge.paidAmount === 0) {
          charge.status = 'UNPAID';
        } else if (charge.paidAmount < charge.issuedAmount) {
          charge.status = 'PARTIALLY_PAID';
        }
        charge.updatedAt = now;
      }
    }

    // Refund wallet if payment was from wallet
    if (payment.paymentSource === 'WALLET') {
      const wallet = store.wallets.find(w => w.studentId === payment.studentId);
      if (wallet) {
        const refundTxn: WalletTransaction = {
          id: generateId('txn_rev'),
          walletId: wallet.id,
          studentId: payment.studentId,
          type: 'PAYMENT_REVERSAL',
          amount: payment.amount,
          referenceNumber: 'REV-' + payment.referenceNumber,
          relatedPaymentId: payment.id,
          description: `Payment Reversal: ${reason.trim()}`,
          createdAt: now
        };
        store.transactions.unshift(refundTxn);
      }
    }

    await this.repo.saveData(store);
    return payment;
  }

  async getFinanceSummary(): Promise<FinanceSummary> {
    const store = await this.repo.getData();

    let totalOutstanding = 0;
    let unpaidCount = 0;
    for (const c of store.charges) {
      if (c.status === 'UNPAID' || c.status === 'PARTIALLY_PAID') {
        totalOutstanding += (c.issuedAmount - c.paidAmount);
        unpaidCount++;
      }
    }

    let totalPayments = 0;
    for (const p of store.payments) {
      if (p.status === 'COMPLETED') {
        totalPayments += p.amount;
      }
    }

    // Sum active wallet credits across all students
    let totalCredits = 0;
    for (const t of store.transactions) {
      if (t.type === 'TOP_UP' || t.type === 'ADJUSTMENT_ADD' || t.type === 'PAYMENT_REVERSAL') {
        totalCredits += t.amount;
      } else if (t.type === 'PAYMENT' || t.type === 'ADJUSTMENT_DEDUCT' || t.type === 'TOPUP_REVERSAL') {
        totalCredits -= t.amount;
      }
    }

    return {
      totalOutstandingCentavos: totalOutstanding,
      totalSimulatedWalletCreditsCentavos: Math.max(0, totalCredits),
      totalPaymentsCollectedCentavos: totalPayments,
      unpaidChargesCount: unpaidCount,
      activeWalletsCount: store.wallets.filter(w => w.status === 'ACTIVE').length
    };
  }
}

export const financeService = new FinanceService();
