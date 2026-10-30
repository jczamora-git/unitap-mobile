import { Preferences } from '@capacitor/preferences';
import type { 
  ChargeTemplate, 
  StudentCharge, 
  Wallet, 
  WalletTransaction, 
  Payment 
} from '@/types/finance';

const FINANCE_STORAGE_KEY = 'unitap_finance_v1';

export interface FinanceDataStore {
  templates: ChargeTemplate[];
  charges: StudentCharge[];
  wallets: Wallet[];
  transactions: WalletTransaction[];
  payments: Payment[];
}

export interface IFinanceRepository {
  getData(): Promise<FinanceDataStore>;
  saveData(store: FinanceDataStore): Promise<void>;
  clearCache(): void;
  resetAll(): Promise<void>;
}

export class LocalFinanceRepository implements IFinanceRepository {
  private cache: FinanceDataStore | null = null;

  clearCache(): void {
    this.cache = null;
  }

  async getData(): Promise<FinanceDataStore> {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      const { value } = await Preferences.get({ key: FINANCE_STORAGE_KEY });
      let data: FinanceDataStore = {
        templates: [],
        charges: [],
        wallets: [],
        transactions: [],
        payments: []
      };

      if (value) {
        const parsed = JSON.parse(value);
        data = {
          templates: Array.isArray(parsed.templates) ? parsed.templates : [],
          charges: Array.isArray(parsed.charges) ? parsed.charges : [],
          wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [],
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
          payments: Array.isArray(parsed.payments) ? parsed.payments : []
        };
      } else {
        const local = typeof localStorage !== 'undefined' ? localStorage.getItem(FINANCE_STORAGE_KEY) : null;
        if (local) {
          const parsed = JSON.parse(local);
          data = {
            templates: Array.isArray(parsed.templates) ? parsed.templates : [],
            charges: Array.isArray(parsed.charges) ? parsed.charges : [],
            wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [],
            transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
            payments: Array.isArray(parsed.payments) ? parsed.payments : []
          };
        }
      }

      this.cache = data;
      return this.cache;
    } catch (err) {
      console.error('Error loading finance storage:', err);
      this.cache = { templates: [], charges: [], wallets: [], transactions: [], payments: [] };
      return this.cache;
    }
  }

  async saveData(store: FinanceDataStore): Promise<void> {
    this.cache = store;
    const jsonStr = JSON.stringify(store);
    try {
      await Preferences.set({ key: FINANCE_STORAGE_KEY, value: jsonStr });
    } catch (err) {
      console.error('Failed to persist finance store:', err);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(FINANCE_STORAGE_KEY, jsonStr);
        }
      } catch {
        // ignore
      }
    }
  }

  async resetAll(): Promise<void> {
    this.cache = {
      templates: [],
      charges: [],
      wallets: [],
      transactions: [],
      payments: []
    };
    await this.saveData(this.cache);
  }
}

export const localFinanceRepository = new LocalFinanceRepository();
