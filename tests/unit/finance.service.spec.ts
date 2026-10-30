import { describe, it, expect, beforeEach } from 'vitest';
import { FinanceService } from '@/services/finance.service';
import type { IFinanceRepository, FinanceDataStore } from '@/storage/finance-storage.service';

class MockFinanceRepo implements IFinanceRepository {
  private data: FinanceDataStore = {
    templates: [],
    charges: [],
    wallets: [],
    transactions: [],
    payments: []
  };

  async getData(): Promise<FinanceDataStore> { return this.data; }
  async saveData(store: FinanceDataStore): Promise<void> { this.data = store; }
  clearCache(): void {}
  async resetAll(): Promise<void> {
    this.data = { templates: [], charges: [], wallets: [], transactions: [], payments: [] };
  }
}

describe('FinanceService', () => {
  let repo: MockFinanceRepo;
  let service: FinanceService;

  beforeEach(() => {
    repo = new MockFinanceRepo();
    service = new FinanceService(repo);
  });

  it('computes wallet balance from immutable ledger transactions', async () => {
    const studentId = 'stu_test_1';
    await service.getOrCreateWallet(studentId);

    // Initial balance should be 0
    let balance = await service.calculateWalletBalance(studentId);
    expect(balance).toBe(0);

    // Top up ₱100 (10000 centavos)
    await service.topUpWallet(studentId, 10000, 'Initial Top-up');
    balance = await service.calculateWalletBalance(studentId);
    expect(balance).toBe(10000);

    // Top up ₱50 (5000 centavos)
    await service.topUpWallet(studentId, 5000, 'Second Top-up');
    balance = await service.calculateWalletBalance(studentId);
    expect(balance).toBe(15000);
  });

  it('issues charges in integer centavos and tracks status', async () => {
    const studentId = 'stu_test_1';
    const charge = await service.issueCharge({
      studentId,
      title: 'Cleanup Absence',
      chargeType: 'FINE',
      issuedAmount: 2000 // ₱20.00
    });

    expect(charge.id).toBeDefined();
    expect(charge.issuedAmount).toBe(2000);
    expect(charge.paidAmount).toBe(0);
    expect(charge.status).toBe('UNPAID');
  });

  it('processes simulated payment and deducts from ledger atomically', async () => {
    const studentId = 'stu_test_1';
    await service.topUpWallet(studentId, 5000, 'Demo Funds'); // ₱50.00

    const charge = await service.issueCharge({
      studentId,
      title: 'IT Day T-Shirt',
      chargeType: 'CONTRIBUTION',
      issuedAmount: 3000 // ₱30.00
    });

    // Pay full charge
    const payment = await service.processPayment({
      studentId,
      allocations: [{ chargeId: charge.id, amountCentavos: 3000 }],
      channel: 'NFC'
    });

    expect(payment.referenceNumber).toBeDefined();
    expect(payment.amount).toBe(3000);

    // Balance should now be 2000 centavos (₱20.00)
    const remainingBalance = await service.calculateWalletBalance(studentId);
    expect(remainingBalance).toBe(2000);

    // Charge status should be PAID
    const charges = await service.getCharges(studentId);
    const updatedCharge = charges.find(c => c.id === charge.id);
    expect(updatedCharge?.status).toBe('PAID');
    expect(updatedCharge?.paidAmount).toBe(3000);
  });

  it('rejects payment when wallet balance is insufficient', async () => {
    const studentId = 'stu_test_1';
    await service.topUpWallet(studentId, 1000, 'Small Funds'); // ₱10.00

    const charge = await service.issueCharge({
      studentId,
      title: 'Sportsfest Fee',
      chargeType: 'CONTRIBUTION',
      issuedAmount: 2500 // ₱25.00
    });

    await expect(service.processPayment({
      studentId,
      allocations: [{ chargeId: charge.id, amountCentavos: 2500 }],
      channel: 'MANUAL'
    })).rejects.toThrow('Insufficient wallet balance');
  });

  it('supports partial payment of charges', async () => {
    const studentId = 'stu_test_1';
    await service.topUpWallet(studentId, 5000, 'Funds'); // ₱50.00

    const charge = await service.issueCharge({
      studentId,
      title: 'Annual Dues',
      chargeType: 'CONTRIBUTION',
      issuedAmount: 4000 // ₱40.00
    });

    // Pay partial ₱20 (2000 centavos)
    await service.processPayment({
      studentId,
      allocations: [{ chargeId: charge.id, amountCentavos: 2000 }],
      channel: 'MANUAL'
    });

    const charges = await service.getCharges(studentId);
    const updated = charges.find(c => c.id === charge.id);
    expect(updated?.status).toBe('PARTIALLY_PAID');
    expect(updated?.paidAmount).toBe(2000);
  });
});
