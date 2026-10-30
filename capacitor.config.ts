import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.unitap.app',
  appName: 'UniTap',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
